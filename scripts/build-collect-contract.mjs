// Collect contract v1 lives in the NexoFolio backend (contracts/collect/v1); src/contracts/collect is a pinned copy.
//   node scripts/build-collect-contract.mjs            verify the copy and generate validators (runs in npm run build)
//   node scripts/build-collect-contract.mjs <v1 dir>   copy the contract from the backend first
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv/dist/2020.js'
import formats from 'ajv-formats'
import standalone from 'ajv/dist/standalone/index.js'

const root = fileURLToPath(new URL('../src/contracts/collect/', import.meta.url))
const source = process.argv[2]
if (source) {
  const files = Object.keys(JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')).files)
  for (const name of [...files, 'manifest.json']) {
    await mkdir(dirname(join(root, name)), { recursive: true })
    await copyFile(join(source, name), join(root, name))
  }
}

const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
for (const [name, digest] of Object.entries(manifest.files)) {
  if (createHash('sha256').update(await readFile(join(root, name))).digest('hex') !== digest) throw new Error(`Collect contract mismatch: ${name}`)
}

const ajv = new Ajv({ strict: false, code: { source: true, esm: true }, allErrors: false })
formats(ajv)
const schemas = { batch: 'batch.schema.json', receipt: 'receipt.schema.json' }
for (const [id, file] of Object.entries(schemas)) ajv.addSchema(JSON.parse(await readFile(join(root, file), 'utf8')), id)

// The backend checks every fixture with serde; checking them here keeps AJV's reading of the schema in line.
for (const [name] of Object.entries(manifest.files)) {
  const match = /^fixtures\/(batch|receipt)\/(valid|invalid)\//.exec(name)
  if (!match) continue
  const valid = ajv.validate(match[1], JSON.parse(await readFile(join(root, name), 'utf8')))
  if (valid !== (match[2] === 'valid')) throw new Error(`Collect fixture disagrees with the schema: ${name}`)
}

let code = standalone(ajv, { validateBatch: 'batch', validateReceipt: 'receipt' })
// Standalone output uses require for format and runtime helpers; MV3 needs static ESM imports.
code = code.replaceAll('require("ajv-formats/dist/formats").fullFormats', 'fullFormats')
  .replaceAll('require("ajv/dist/runtime/ucs2length").default', 'ucs2length')
  .replaceAll('require("ajv/dist/runtime/equal").default', 'equal')
const header = [
  'import { fullFormats } from "ajv-formats/dist/formats";',
  'import ucs2lengthModule from "ajv/dist/runtime/ucs2length";',
  'import equalModule from "ajv/dist/runtime/equal";',
  'const ucs2length = typeof ucs2lengthModule === "function" ? ucs2lengthModule : ucs2lengthModule.default;',
  'const equal = typeof equalModule === "function" ? equalModule : equalModule.default;',
  `export const limits = ${JSON.stringify(manifest.limits)};`,
].join('\n')
await writeFile(join(root, 'validators.js'), header + '\n' + code)
await writeFile(join(root, 'validators.d.ts'), [
  'export const limits: { records_per_batch: number; batch_bytes: number; record_bytes: number };',
  'export function validateBatch(value: unknown): boolean;',
  'export function validateReceipt(value: unknown): boolean;',
  '',
].join('\n'))
