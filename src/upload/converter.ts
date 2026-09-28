import { validateBatch, validateReceipt } from '../contracts/collect/validators.js'
import { ApiError } from '../api/nexofolio/client'
import type { CapturedBody, CapturedHeaders } from '../capture/contracts'
import { encodedSize, MAX_RECORD_BYTES, type Body, type CollectBatch, type CollectRecord, type Destination, type ExchangeContext, type Headers, type Observation, type Receipt } from './contracts'

export function terminal(value: Observation) { return value.request.body.state !== 'reading' && !['pending','reading'].includes(value.response.state) }
export function interrupted(value: Observation): Observation {
  return { ...value, request: { ...value.request, body: value.request.body.state === 'reading' ? { ...value.request.body, state:'unreadable',message:'采集进程中断。' } : value.request.body }, response: ['pending','reading'].includes(value.response.state) ? { ...value.response,state:'unreadable',message:'采集进程中断。' } : value.response }
}

export function batchOf(destination: Destination, records: CollectRecord[], batchId: string = crypto.randomUUID()): CollectBatch {
  return {
    batch_id:batchId, platform:'nexofolio-fetcher', platform_version:chrome.runtime.getManifest().version,
    target:{ project_id:destination.projectId, environment:destination.environment, ...(destination.site ? { site:destination.site } : {}) },
    records,
  }
}

// Captured state → wire state. What the page could not read is reported as unreadable with the reason, never dropped.
function body(data: CapturedBody): Body {
  const media = data.contentType ? { media_type:data.contentType.slice(0,255) } : {}
  const encoding = data.encoding === 'base64' ? 'base64' : 'utf8'
  if (data.state === 'complete') return { state:'full', ...media, encoding, content:data.body, bytes:data.bytes }
  // Captured bytes of a truncated body are not the original size, so bytes is left out.
  if (data.state === 'truncated') return { state:'truncated', ...media, encoding, content:data.body }
  if (data.state === 'none') return { state:'none' }
  return { state:'unreadable', ...media, ...(data.message ? { note:data.message.slice(0,1024) } : {}) }
}
// Page scripts never see forbidden headers (Cookie etc.), so what they saw is partial.
function headers(data: CapturedHeaders): Headers | undefined {
  if (data.state === 'unreadable') return undefined
  const entries = data.entries.slice(0,256)
  return { state:data.state === 'truncated' || entries.length < data.entries.length ? 'truncated' : 'partial', entries }
}
const iso = (ms?: number) => ms === undefined ? undefined : new Date(ms).toISOString()

export function convert(value: Observation, id: string, clientId: string): CollectRecord {
  if (!terminal(value)) throw new Error('NON_TERMINAL')
  const c = value.context
  const context: ExchangeContext = Object.fromEntries(Object.entries({
    page_url:c?.page_url ?? value.sourcePage, page_title:value.title, client_instance_id:clientId,
    page_id:c?.page_instance_id, frame_id:c?.frame_instance_id, view_id:c?.view_id, interaction_id:c?.interaction_id, seq:c?.event_seq,
    transport:value.transport, frame:value.frame, started_at:iso(c?.request_started_at_ms), completed_at:iso(c?.response_completed_at_ms),
  }).filter(([,v]) => v !== undefined && v !== ''))
  const response = value.response
  const requestHeaders = headers(value.request.headers), responseHeaders = headers(response.headers)
  // No stripping credentials, no URL rewriting, no truncation to fit the transport.
  return { id, kind:'http_exchange', version:1, observed_at:new Date(value.time).toISOString(), context, payload:{
    request:{ method:value.method.toUpperCase(), url:value.request.url, ...(value.request.urlTruncated ? { url_truncated:true } : {}), ...(requestHeaders ? { headers:requestHeaders } : {}), body:body(value.request.body) },
    ...(response.status !== null && response.status >= 100 ? { response:{
      status:response.status, ...(responseHeaders ? { headers:responseHeaders } : {}),
      body:body({ state:response.state === 'failed' ? 'unreadable' : response.state as CapturedBody['state'], encoding:response.encoding, body:response.body, bytes:response.bytes, contentType:response.contentType, message:response.message }),
    } } : {}),
  } }
}

export function recordFailure(record: CollectRecord, destination: Destination) {
  if (encodedSize(record) > MAX_RECORD_BYTES) return 'RECORD_TOO_LARGE'
  if (!validateBatch(batchOf(destination,[record]))) return 'INVALID_RECORD'
  return ''
}

// Checks the receipt against the batch it answers; returns the rejected records by index. Everything else was accepted.
export function rejections(reply: unknown, batch: CollectBatch) {
  const fail = () => new ApiError('protocol','服务返回的回执与批次不一致。')
  if (!validateReceipt(reply)) throw fail()
  const receipt = reply as Receipt
  if (receipt.batch_id !== batch.batch_id || receipt.accepted + receipt.rejected.length !== batch.records.length) throw fail()
  const rejected = new Map<number,string>()
  for (const item of receipt.rejected) {
    if (rejected.has(item.index) || batch.records[item.index]?.id !== item.id) throw fail()
    rejected.set(item.index,item.reason)
  }
  return rejected
}
