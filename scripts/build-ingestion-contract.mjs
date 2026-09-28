import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import Ajv from 'ajv/dist/2020.js'
import formats from 'ajv-formats'
import standalone from 'ajv/dist/standalone/index.js'
const root = new URL('../src/contracts/ingestion/', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'))
for (const [name, digest] of Object.entries({ ...manifest.files, 'types.generated.ts': manifest.types_sha256 })) {
  if (createHash('sha256').update(await readFile(new URL(name, root))).digest('hex') !== digest) throw new Error(`Pinned contract mismatch: ${name}`)
}
const captureRoot = new URL('../src/contracts/capture/', import.meta.url)
const captureManifest = JSON.parse(await readFile(new URL('manifest.json', captureRoot), 'utf8'))
for (const [name, digest] of Object.entries(captureManifest.files)) {
  if (createHash('sha256').update(await readFile(new URL(name, captureRoot))).digest('hex') !== digest) throw new Error(`Capture contract mismatch: ${name}`)
}
const ajv = new Ajv({ strict: false, code: { source: true, esm: true }, allErrors: false })
formats(ajv)
for (const format of ['int64','uint64','uint32','uint','double']) ajv.addFormat(format, true)
for (const [id,file] of [['captureBatch','batch.schema.json'],['captureRecord','record.schema.json'],['captureReceipt','receipt.schema.json'],['captureCapabilities','capabilities.schema.json'],['assetReceipt','asset.schema.json'],['captureContext','context.schema.json']]) ajv.addSchema(JSON.parse(await readFile(new URL(file,captureRoot),'utf8')),id)
for (const [id, file] of [['batch','batch.schema.json'], ['receipt','receipt.schema.json'], ['capabilities','capabilities.schema.json'], ['environmentList','environment-page.schema.json'], ['environment','environment.schema.json'], ['batchV1','legacy/v1/batch.schema.json'], ['receiptV1','legacy/v1/receipt.schema.json'], ['capabilitiesV1','legacy/v1/capabilities.schema.json']]) ajv.addSchema(JSON.parse(await readFile(new URL(file,root),'utf8')),id)
let code = standalone(ajv, { validateBatch:'batch', validateReceipt:'receipt',validateCapabilities:'capabilities',validateEnvironmentList:'environmentList',validateEnvironment:'environment',validateBatchV1:'batchV1',validateReceiptV1:'receiptV1',validateCapabilitiesV1:'capabilitiesV1',validateCaptureBatch:'captureBatch',validateCaptureRecord:'captureRecord',validateCaptureReceipt:'captureReceipt',validateCaptureCapabilities:'captureCapabilities',validateAssetReceipt:'assetReceipt',validateCaptureContext:'captureContext' })
// ajv-formats uuid/date-time helpers use require in standalone output; provide a static ESM import for MV3.
code = code.replaceAll('require("ajv-formats/dist/formats").fullFormats', 'fullFormats')
  .replaceAll('require("ajv/dist/runtime/ucs2length").default', 'ucs2length')
  .replaceAll('require("ajv/dist/runtime/equal").default', 'equal')
await writeFile(new URL('validators.js',root), 'import { fullFormats } from "ajv-formats/dist/formats";\nimport ucs2lengthModule from "ajv/dist/runtime/ucs2length";\nimport equalModule from "ajv/dist/runtime/equal";\nconst ucs2length = typeof ucs2lengthModule === "function" ? ucs2lengthModule : ucs2lengthModule.default;\nconst equal = typeof equalModule === "function" ? equalModule : equalModule.default;\n'+code)
await writeFile(new URL('validators.d.ts',root), 'export function validateBatch(value: unknown): boolean;\nexport function validateReceipt(value: unknown): boolean;\nexport function validateCapabilities(value: unknown): boolean;\nexport function validateEnvironmentList(value: unknown): boolean;\nexport function validateEnvironment(value: unknown): boolean;\nexport function validateBatchV1(value: unknown): boolean;\nexport function validateReceiptV1(value: unknown): boolean;\nexport function validateCapabilitiesV1(value: unknown): boolean;\nexport function validateCaptureBatch(value: unknown): boolean;\nexport function validateCaptureRecord(value: unknown): boolean;\nexport function validateCaptureReceipt(value: unknown): boolean;\nexport function validateCaptureCapabilities(value: unknown): boolean;\nexport function validateAssetReceipt(value: unknown): boolean;\nexport function validateCaptureContext(value: unknown): boolean;\n')
