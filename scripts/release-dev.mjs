import { readFileSync, existsSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs, parseEnv } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import OSS from 'ali-oss'
import { RELEASE_ROOT as base, LATEST_URL, parseRelease, compareVersions, versionParts } from '../src/updates/policy.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const prefix = 'nexofolio_fetcher/'
const hash = data => createHash('sha256').update(data).digest('hex')
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|SystemRoot|COMSPEC|PATHEXT|LANG|LC_.*|TERM|CI)$/.test(key)))
function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: root, stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'], input, env: childEnv })
  if (result.error || result.status !== 0) throw new Error(`${command} failed; release stopped.`)
}
async function download(url, manifest = false) {
  const response = await fetch(`${url}?verify=${Date.now()}-${randomUUID()}`, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(60000) })
  if (manifest && response.status === 404) return null
  if (response.status !== 200) throw new Error(`Public download failed: HTTP ${response.status}`)
  if (manifest) {
    const date = Date.parse(response.headers.get('date') || ''), age = Number(response.headers.get('age') || 0)
    if (!Number.isFinite(date) || Math.abs(Date.now() - date) > 120000 || !Number.isFinite(age) || age > 60) throw new Error('OSS metadata is not fresh.')
  }
  const max = manifest ? 65536 : 512 * 1024 * 1024
  const reader = response.body.getReader(), chunks = []; let size = 0
  for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > max) { await reader.cancel(); throw new Error('Download exceeds limit.') } chunks.push(Buffer.from(item.value)) }
  return Buffer.concat(chunks)
}
function rememberRelease(release) {
  const path = resolve(root, '.release-policy.local')
  const previous = existsSync(path) ? parseRelease(JSON.parse(readFileSync(path, 'utf8'))) : null
  if (previous && (!release || (release.policyRevision || 0) < (previous.policyRevision || 0)
    || compareVersions(release.minimumVersion || '0.0.0', previous.minimumVersion || '0.0.0') < 0
    || compareVersions(release.version, previous.version) < 0
    || (previous.policyRevision && release.policyRevision === previous.policyRevision && JSON.stringify(release) !== JSON.stringify(previous)))) {
    throw new Error('OSS policy is below the publisher high-water mark; refusing to reset the minimum.')
  }
  if (release) writeFileSync(path, JSON.stringify(release, null, 2), { mode:0o600 })
}
function client() {
  const path = resolve(root, '.env.oss.local'), local = existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {}
  const config = { ...local, ...process.env }
  for (const key of ['OSS_ACCESS_KEY_ID','OSS_ACCESS_KEY_SECRET','OSS_ENDPOINT','OSS_BUCKET_NAME']) if (!config[key]) throw new Error(`Missing ${key}; configure .env.oss.local.`)
  if (config.OSS_BUCKET_NAME !== 'asynctest' || new URL(config.OSS_ENDPOINT).origin !== 'https://oss-cn-shenzhen.aliyuncs.com') throw new Error('Unexpected OSS target.')
  return new OSS({ accessKeyId: config.OSS_ACCESS_KEY_ID, accessKeySecret: config.OSS_ACCESS_KEY_SECRET, endpoint: config.OSS_ENDPOINT, bucket: config.OSS_BUCKET_NAME, secure: true, timeout: 60000 })
}
async function getOrNull(oss, key) { try { return (await oss.get(key)).content } catch (error) { if (error.code === 'NoSuchKey') return null; throw error } }
async function main() {
  const { values } = parseArgs({ options: { version: { type:'string' }, normal: { type:'boolean' }, force: { type:'boolean' }, 'notes-file': { type:'string' }, 'package-only': { type:'boolean' }, 'upload-only': { type:'boolean' }, help: { type:'boolean' } } })
  if (values.help) { console.log('npm run release:dev -- --version X.Y.Z (--normal|--force) --notes-file FILE [--package-only]\nRetry the frozen release: npm run release:dev -- --version X.Y.Z (--normal|--force) --upload-only\nA missing mode is an error. Published ZIPs cannot be replaced. No git commit/tag/push.'); return }
  if (!!values.normal === !!values.force) throw new Error('Choose exactly one explicit release mode: --normal or --force.')
  if (values['package-only'] && values['upload-only']) throw new Error('Choose package-only or upload-only.')
  if (!values.version || !/^\d+\.\d+\.\d+$/.test(values.version)) throw new Error('Specify --version X.Y.Z explicitly.')
  versionParts(values.version)
  const version = values.version, mode = values.force ? 'force' : 'normal'
  if (existsSync(resolve(root, '.output/capture-reset-maintenance/state.json'))) throw new Error('Restore the maintenance build before release.')
  const localLock = resolve(root, '.release-dev.lock.local')
  const fd = openSync(localLock, 'wx', 0o600); closeSync(fd)
  try {
    const directory = resolve(root, '.output/releases', `${version}-dev`), planPath = resolve(directory, 'release-plan.json')
    let plan
    if (values['upload-only']) {
      plan = JSON.parse(readFileSync(planPath, 'utf8'))
      if (plan.version !== version || plan.mode !== mode) throw new Error('Retry must match the frozen version and release mode.')
      if (values['notes-file']) throw new Error('Retry uses frozen notes; do not supply new notes.')
    } else {
      if (existsSync(planPath)) throw new Error('Release plan already frozen. Use --upload-only or a new version; do not overwrite.')
      if (!values['notes-file']) throw new Error('Supply --notes-file with one release note per line.')
      const notesText = readFileSync(resolve(values['notes-file']), 'utf8')
      if (notesText.length > 32000) throw new Error('Release notes too long.')
      const notes = notesText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
      if (!notes.length || notes.length > 32 || notes.some(note => note.length > 1000)) throw new Error('Provide 1–32 notes, each at most 1000 characters.')
      const remoteBytes = await download(LATEST_URL, true), remote = remoteBytes ? parseRelease(JSON.parse(remoteBytes)) : null
      rememberRelease(remote)
      const current = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
      if (compareVersions(version, current) < 0 || (remote && compareVersions(version, remote.version) <= 0)) throw new Error('Use a new version above the published version and not below the local version.')
      plan = { id: randomUUID(), version, mode, notes, revision: (remote?.policyRevision || 0) + 1,
        minimumVersion: mode === 'force' ? version : remote?.minimumVersion || '0.0.0', baseSha256: remoteBytes ? hash(remoteBytes) : null }
      mkdirSync(directory, { recursive: true })
      writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n', { flag:'wx' })
      if (version !== current) run('npm', ['version',version,'--no-git-tag-version','--ignore-scripts'])
      run('npm', ['run','build'])
      run('python3', ['scripts/package-release.py','--plan',planPath])
    }
    const secretConfigPath = resolve(root, '.env.oss.local')
    const secretConfig = { ...(existsSync(secretConfigPath) ? parseEnv(readFileSync(secretConfigPath, 'utf8')) : {}), ...process.env }
    const privateValues = ['OSS_ACCESS_KEY_ID','OSS_ACCESS_KEY_SECRET'].map(key => secretConfig[key]).filter(value => typeof value === 'string' && value.length > 8)
    run('python3', ['scripts/package-release.py','--verify-only','--version',version,'--check-secrets-stdin'], JSON.stringify(privateValues))
    const manifestBytes = readFileSync(resolve(directory, 'latest.json')), release = parseRelease(JSON.parse(manifestBytes))
    const archive = readFileSync(resolve(directory, release.artifact.filename))
    if (release.version !== version || release.releaseMode !== mode || release.policyRevision !== plan.revision || release.minimumVersion !== plan.minimumVersion
      || JSON.stringify(release.releaseNotes) !== JSON.stringify(plan.notes) || hash(archive) !== release.artifact.sha256 || archive.length !== release.artifact.size) throw new Error('Frozen plan, manifest and archive differ.')
    const sealPath = resolve(directory, 'release-seal.json')
    const seal = { id:plan.id, plan:hash(readFileSync(planPath)), manifest:hash(manifestBytes), archive:hash(archive) }
    if (existsSync(sealPath)) { if (JSON.stringify(JSON.parse(readFileSync(sealPath))) !== JSON.stringify(seal)) throw new Error('Frozen release was modified; refused.') }
    else writeFileSync(sealPath, JSON.stringify(seal), { flag:'wx' })
    if (values['package-only']) { console.log(`Packaged ${version} (${mode}); minimum ${release.minimumVersion}. Nothing uploaded.`); return }
    const oss = client(), lockKey = prefix + '.release-lock.json'
    const lock = Buffer.from(JSON.stringify(seal))
    // OSS PutObject does not provide a portable destination If-Match CAS.
    // A forbid-overwrite lock serializes cooperating publishers. No automatic TTL/stealing.
    const existingLock = await getOrNull(oss, lockKey)
    if (existingLock && !existingLock.equals(lock)) throw new Error('Another frozen release holds the OSS lock. Do not delete it until its publisher has stopped.')
    if (!existingLock) await oss.put(lockKey, lock, { headers: { 'x-oss-forbid-overwrite':'true', 'x-oss-object-acl':'private', 'Content-Type':'application/json' } })
    if (!(await getOrNull(oss, lockKey))?.equals(lock)) throw new Error('OSS release lock ownership mismatch.')
    // On all uncertain outcomes leave the lock in place for an identical upload-only retry.
    const remoteBytes = await download(LATEST_URL, true)
    rememberRelease(remoteBytes ? parseRelease(JSON.parse(remoteBytes)) : null)
    if (remoteBytes?.equals(manifestBytes)) {
      const downloaded = await download(release.artifact.url)
      if (downloaded.length !== archive.length || hash(downloaded) !== hash(archive)) throw new Error('Published archive mismatch.')
      rememberRelease(release)
      await oss.delete(lockKey); console.log(`Release ${version} already published and verified.`); return
    }
    if ((remoteBytes ? hash(remoteBytes) : null) !== plan.baseSha256) throw new Error('Remote policy changed after packaging; do not overwrite or lower its minimum. Prepare a new release.')
    const oldArchive = await getOrNull(oss, prefix + release.artifact.filename)
    if (oldArchive && !oldArchive.equals(archive)) throw new Error('Versioned ZIP already exists with different bytes. Publish a new version.')
    if (!oldArchive) await oss.put(prefix + release.artifact.filename, archive, { headers: {
      'Content-Type':'application/zip', 'Content-Disposition':`attachment; filename="${release.artifact.filename}"`,
      'Cache-Control':'public, max-age=31536000, immutable', 'x-oss-object-acl':'public-read', 'x-oss-forbid-overwrite':'true',
    } })
    const downloaded = await download(release.artifact.url)
    if (downloaded.length !== archive.length || hash(downloaded) !== hash(archive)) throw new Error('Public ZIP size/hash verification failed; policy NOT published.')
    if (!(await getOrNull(oss, lockKey))?.equals(lock)) throw new Error('Lost release lock.')
    const beforePublish = await download(LATEST_URL, true)
    if ((beforePublish ? hash(beforePublish) : null) !== plan.baseSha256) throw new Error('Remote latest.json changed; policy NOT published.')
    await oss.put(prefix + 'latest.json', manifestBytes, { headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-cache, max-age=0, must-revalidate', 'x-oss-object-acl':'public-read' } })
    if (!(await download(LATEST_URL, true))?.equals(manifestBytes)) throw new Error('Public policy readback differs. Leave the lock and investigate.')
    rememberRelease(release)
    await oss.delete(lockKey)
    console.log(`Published ${version} (${mode}); minimum ${release.minimumVersion}. ZIP size/SHA-256 and latest.json readback verified.\n${release.artifact.url}\n${LATEST_URL}`)
  } finally { unlinkSync(localLock) }
}
main().catch(error => {
  // Never dump SDK request objects, credentials, signatures or stacks.
  if (error.code || error.status) console.error(`Release failed: ${String(error.code || 'unknown').replace(/[^a-zA-Z0-9_-]/g,'')} HTTP ${Number(error.status) || 'unknown'}`)
  else console.error(error.message)
  process.exitCode = 1
})
