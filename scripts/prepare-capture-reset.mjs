import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = resolve(root, '.output/chrome-mv3')
const backup = resolve(root, '.output/capture-reset-maintenance')
const statePath = resolve(backup, 'state.json')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const action = process.argv[2]
async function readState() {
  try { return JSON.parse(await readFile(statePath, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
async function replace(path, bytes) {
  await writeFile(path + '.maintenance-tmp', bytes)
  await rename(path + '.maintenance-tmp', path)
}
async function main() {
  if (!['prepare', 'restore', 'status'].includes(action) || process.argv.length !== 3) {
    console.log('Usage: node scripts/prepare-capture-reset.mjs prepare|restore|status\nOnly changes the unpacked build; never opens Chrome or clears browser data. Read docs/capture-reset.md first.')
    return
  }
  const manifestBytes = await readFile(resolve(output, 'manifest.json'))
  const manifest = JSON.parse(manifestBytes)
  if (manifest.name !== 'NexoFolio Fetcher' || manifest.background?.service_worker !== 'background.js') {
    throw new Error('Unexpected unpacked extension. Build the normal extension first.')
  }
  const target = resolve(output, 'background.js')
  const current = await readFile(target)
  const state = await readState()
  if (action === 'status') {
    console.log(JSON.stringify({ directory: output, prepared: !!state, maintenanceBuild: !!state && hash(current) === state.maintenanceHash }, null, 2))
    return
  }
  if (action === 'prepare') {
    if (state) throw new Error('A maintenance backup already exists. Use status/restore before preparing again.')
    const maintenance = await readFile(new URL('./capture-reset-worker.js', import.meta.url))
    await mkdir(backup, { recursive: true })
    await writeFile(resolve(backup, 'background.original.js'), current)
    await writeFile(statePath, JSON.stringify({ originalHash: hash(current), maintenanceHash: hash(maintenance), manifestHash: hash(manifestBytes) }, null, 2))
    await replace(target, maintenance)
    console.log(`Maintenance build prepared in the SAME loading directory: ${output}\nNo browser data was changed. Stop backend API/worker; close the panel; manually reload this existing extension. Follow docs/capture-reset.md.`)
    return
  }
  if (!state) throw new Error('No maintenance backup exists.')
  const original = await readFile(resolve(backup, 'background.original.js'))
  if (hash(original) !== state.originalHash || hash(manifestBytes) !== state.manifestHash
    || ![state.maintenanceHash, state.originalHash].includes(hash(current))) {
    throw new Error('Build changed during maintenance; refusing to overwrite it. Keep the backend paused and inspect the saved build before recovery.')
  }
  await replace(target, original)
  await rm(statePath)
  console.log('Normal background restored. No browser data was changed. Keep backend paused until the manual clearing receipt is confirmed; reload the extension on an unbound/new-tab page only when ready.')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
