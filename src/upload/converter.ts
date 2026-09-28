import type { IngestionBatch, Record as IngestionRecord, Body } from '../contracts/ingestion/types.generated'
import { validateBatch, validateReceipt, validateBatchV1, validateReceiptV1, validateCaptureBatch, validateCaptureRecord, validateCaptureReceipt } from '../contracts/ingestion/validators.js'
import type { CapturedBody } from '../capture/contracts'
import { encodedSize, legacyService, MAX_RECORD_BYTES, type Destination, type Observation, type UploadBatch, type QueueRecord } from './contracts'
export function terminal(value: Observation) { return value.request.body.state !== 'reading' && !['pending','reading'].includes(value.response.state) }
export function interrupted(value: Observation): Observation {
  return { ...value, request: { ...value.request, body: value.request.body.state === 'reading' ? { ...value.request.body, state:'unreadable',message:'采集进程中断。' } : value.request.body }, response: ['pending','reading'].includes(value.response.state) ? { ...value.response,state:'unreadable',message:'采集进程中断。' } : value.response }
}
export function batchOf(destination: Destination, instanceId: string, records: QueueRecord[], batchId = crypto.randomUUID(), version: '1' | '2' | '3' = '3'): UploadBatch {
  const common = {batch_id:batchId,project_id:destination.projectId,environment:destination.environment,source:{type:'nexofolio-fetcher',instance_id:instanceId},records}
  if (version === '3') return { ...common, schema_version:'3' }
  const legacy = { ...common, records: records as IngestionRecord[] }
  return version === '1' ? { ...legacy, schema_version:'1', service_key:legacyService(destination) } : { ...legacy, schema_version:'2' }
}
export function convert(value: Observation, id = crypto.randomUUID()): IngestionRecord {
  if (!terminal(value)) throw new Error('NON_TERMINAL')
  const body = (data: CapturedBody): Body => ({state:data.state as Body['state'],encoding:data.encoding,content:data.body,bytes:data.bytes})
  // No stripping credentials, no URL rewriting, no truncation to fit the transport.
  return { record_id:id,kind:'http_exchange',payload_version:'1',...(value.context ? {context:value.context} : {}),captured_at:new Date(value.time).toISOString(),payload:{
    request:{url:value.request.url,url_truncated:value.request.urlTruncated,method:value.method as IngestionRecord['payload']['request']['method'],headers:{state:value.request.headers.state,entries:value.request.headers.entries},body:body(value.request.body)},
    response:{state:value.response.state as IngestionRecord['payload']['response']['state'],status:value.response.status && value.response.status>=100 ? value.response.status : null,url:value.response.url,headers:{state:value.response.headers.state,entries:value.response.headers.entries},body:body({...value.response,state:value.response.state==='failed'?'unreadable':value.response.state as Body['state']})},
    source_page:value.sourcePage,transport:value.transport,frame:value.frame,
  } }
}
export function recordFailure(record: QueueRecord, destination: Destination, instanceId: string, version: '1' | '2' | '3' = '3') {
  if (encodedSize(record)>MAX_RECORD_BYTES) return 'RECORD_TOO_LARGE'
  if (version === '3' && !validateCaptureRecord(record)) return 'INVALID_RECORD'
  if (!(version === '3' ? validateCaptureBatch : version === '1' ? validateBatchV1 : validateBatch)(batchOf(destination,instanceId,[record],undefined,version))) return 'INVALID_RECORD'
  return ''
}
export function checkedReceipt(value: unknown, batch: UploadBatch) {
  if (!(batch.schema_version === '3' ? validateCaptureReceipt : batch.schema_version === '1' ? validateReceiptV1 : validateReceipt)(value)) throw new Error('INVALID_RECEIPT')
  const receipt=value as import('../contracts/ingestion/types.generated').BatchReceipt | import('../contracts/ingestion/legacy/v1/types.generated').BatchReceipt | import('../contracts/capture/types.generated').CaptureBatchReceipt
  if (receipt.schema_version!==batch.schema_version || receipt.batch_id!==batch.batch_id || receipt.results.length!==batch.records.length) throw new Error('INCOMPLETE_RECEIPT')
  if (receipt.results.some(r => r.status !== 'rejected') && !receipt.environment) throw new Error('INVALID_ENVIRONMENT_RECEIPT')
  if ('id' in batch.environment && receipt.environment && receipt.environment.id !== batch.environment.id) throw new Error('MISMATCHED_ENVIRONMENT_RECEIPT')
  const indices=new Set<number>()
  for(const result of receipt.results) {
    if(indices.has(result.record_index) || batch.records[result.record_index]?.record_id!==result.record_id) throw new Error('MISMATCHED_RECEIPT')
    if(result.status!=='rejected' && (result.retryable || (batch.schema_version === '3' ? !('observation_id' in result && result.observation_id) : !result.ingestion_id))) throw new Error('INVALID_RECEIPT')
    indices.add(result.record_index)
  }
  return receipt
}
