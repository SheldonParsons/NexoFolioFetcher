import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import OSS from 'ali-oss';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'https://asynctest.oss-cn-shenzhen.aliyuncs.com/nexofolio_fetcher/';
const prefix = 'nexofolio_fetcher/';
const hash = data => createHash('sha256').update(data).digest('hex');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${command} failed; release stopped.`);
}
async function download(url) {
  const response = await fetch(`${url}?verify=${Date.now()}`, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Public download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
async function main() {
  const { values } = parseArgs({ options: {
    version: { type: 'string' },
    'package-only': { type: 'boolean' },
    'upload-only': { type: 'boolean' },
    'replace-published': { type: 'boolean' },
    help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('npm run release:dev -- [--version 0.1.1] [--package-only | --upload-only] [--replace-published]\nDefault: build, package and publish. --upload-only retries an existing package. Published ZIPs require --replace-published to replace differing bytes.');
    return;
  }
  if (values['package-only'] && values['upload-only']) throw new Error('Choose package-only or upload-only.');
  if (values['upload-only'] && values.version) throw new Error('upload-only uses the existing package version.');
  const current = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
  const version = values.version ?? current;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
    || version.split('.').some(part => Number(part) > 65535)
    || version === '0.0.0') throw new Error('Use a Chrome-compatible three-part version, e.g. 0.1.1 (each part 0–65535).');
  if (values.version && version !== current) {
    const a = version.split('.').map(Number), b = current.split('.').map(Number);
    const different = a.findIndex((value, i) => value !== b[i]);
    if (different === -1 || a[different] < b[different]) throw new Error('The new version must be greater than the current version.');
  }

  // Read secrets only in this release process. Child builds receive no injected OSS credentials.
  let client;
  if (!values['package-only']) {
    const configPath = resolve(root, '.env.oss.local');
    const local = existsSync(configPath) ? parseEnv(readFileSync(configPath, 'utf8')) : {};
    const config = { ...local, ...process.env };
    for (const key of ['OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_ENDPOINT', 'OSS_BUCKET_NAME']) {
      if (!config[key]) throw new Error(`Missing ${key}; configure .env.oss.local using .env.oss.example.`);
    }
    if (config.OSS_BUCKET_NAME !== 'asynctest' || new URL(config.OSS_ENDPOINT).origin !== 'https://oss-cn-shenzhen.aliyuncs.com') {
      throw new Error('OSS target must match the configured public release URLs.');
    }
    client = new OSS({ accessKeyId: config.OSS_ACCESS_KEY_ID, accessKeySecret: config.OSS_ACCESS_KEY_SECRET,
      endpoint: config.OSS_ENDPOINT, bucket: config.OSS_BUCKET_NAME, secure: true, timeout: 60000 });
  }

  if (!values['upload-only']) {
    if (version !== current) run('npm', ['version', version, '--no-git-tag-version', '--ignore-scripts']);
    run('npm', ['run', 'build']);
    run('python3', ['scripts/package-release.py', '--replace-local', '--base-url', base]);
  }
  const directory = resolve(root, '.output/releases', `${version}-dev`);
  const manifestBytes = readFileSync(resolve(directory, 'latest.json'));
  const release = JSON.parse(manifestBytes);
  const filename = `NexoFolio-Fetcher-${version}-dev.zip`;
  const archive = readFileSync(resolve(directory, filename));
  if (release.schemaVersion !== 1 || release.product !== 'nexofolio-fetcher' || release.version !== version
    || release.artifact.filename !== filename || release.artifact.url !== base + filename
    || release.artifact.size !== archive.length || release.artifact.sha256 !== hash(archive)) {
    throw new Error('Package and latest.json do not match; rebuild before uploading.');
  }
  if (!client) return;

  // Existing versioned objects are reusable only when their bytes are identical.
  let exists = false;
  try {
    const remote = await client.get(prefix + filename);
    exists = true;
    if (hash(remote.content) !== hash(archive)) {
      if (!values['replace-published']) throw new Error('This version already exists on OSS with different content. Publish a new version or explicitly use --replace-published.');
      exists = false;
    }
  } catch (error) {
    if (error.code !== 'NoSuchKey') throw error;
  }
  if (!exists) {
    await client.put(prefix + filename, archive, { headers: {
      'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache, max-age=0, must-revalidate',
      'x-oss-object-acl': 'public-read', 'x-oss-forbid-overwrite': values['replace-published'] ? 'false' : 'true',
    } });
  }
  if (hash(await download(base + filename)) !== hash(archive)) throw new Error('Public ZIP checksum differs; latest.json was not published.');
  console.log(`ZIP uploaded and SHA-256 verified: ${base}${filename}`);
  await client.put(prefix + 'latest.json', manifestBytes, { headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache, max-age=0, must-revalidate',
    'x-oss-object-acl': 'public-read',
  } });
  if (!manifestBytes.equals(await download(base + 'latest.json'))) throw new Error('Public latest.json differs; check OSS before retrying.');
  console.log(`Release published and verified: ${base}latest.json`);
}

main().catch(error => {
  // SDK error objects can contain signed requests. Never dump them or their stacks.
  if (error.code || error.status) console.error(`Release failed: code=${String(error.code ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '')}, HTTP=${Number(error.status) || 'unknown'}`);
  else console.error(error.message);
  process.exitCode = 1;
});
