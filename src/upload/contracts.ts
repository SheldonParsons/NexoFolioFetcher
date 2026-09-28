import type { CapturedInput, CapturedResponse } from '../capture/contracts'
import type { EvidenceContext } from '../evidence/context'
import { limits } from '../contracts/collect/validators.js'

// Wire shapes of collect v1 (src/contracts/collect, pinned from the NexoFolio backend).
export type Headers = { state: 'complete' | 'partial' | 'truncated'; entries: [string, string][] }
export type Body =
  | { state: 'full' | 'truncated'; media_type?: string; encoding: 'utf8' | 'base64'; content: string; bytes?: number }
  | { state: 'unreadable'; media_type?: string; note?: string }
  | { state: 'none' }
export interface ExchangeContext {
  page_url?: string; page_title?: string; client_instance_id?: string; page_id?: string; frame_id?: string; view_id?: string
  interaction_id?: string; seq?: number; transport?: 'xhr' | 'fetch' | 'other'; frame?: 'page' | 'iframe'; started_at?: string; completed_at?: string
}
export interface CollectRecord {
  id: string; kind: 'http_exchange'; version: 1; observed_at: string; context?: ExchangeContext
  payload: {
    request: { method: string; url: string; url_truncated?: boolean; headers?: Headers; body: Body }
    response?: { status: number; headers?: Headers; body: Body }
  }
}
export interface Site { origin: string; prefix: string }
export interface CollectBatch {
  batch_id: string; platform: string; platform_version?: string
  target: { project_id: string; environment: { id: string } | { name: string }; site?: Site }
  records: CollectRecord[]
}
export interface Rejection { index: number; id: string; reason: string; message?: string }
export interface Receipt { batch_id: string; accepted: number; rejected: Rejection[] }

// Where a capture goes. userId only scopes the panel's view; uploading needs no login.
export interface Destination { serviceUrl: string; userId: string; projectId: string; environment: { id: string } | { name: string }; site?: Site }
export interface Observation { context?: EvidenceContext; title?: string; request: CapturedInput; response: CapturedResponse; method: string; time: number; sourcePage: string; transport: 'xhr' | 'fetch'; frame: 'page' | 'iframe' }
// format marks items written for collect v1; older items are upgraded or failed on restore.
export interface QueueItem { format?: 'collect-v1'; id: string; destination: Destination; observation?: Observation; createdAt: number; size: number; state: 'draft' | 'ready' | 'batched' | 'failed'; record?: CollectRecord; failure?: string }
export interface QueueBatch { id: string; destination: Destination; itemIds: string[]; wire: CollectBatch; attempts: number; nextAttempt: number }
export interface QueueStatus { pending: number; failed: number; bytes: number; paused: boolean; message: string; failures: { reason: string; count: number }[] }
export interface ObservationUploadState { state: 'collecting' | 'queued' | 'sending' | 'confirmed' | 'failed'; message: string }

export const MAX_QUEUE_BYTES = 256 * 1024 * 1024
export const MAX_QUEUE_ITEMS = 5000
export const RESERVATION_BYTES = 48 * 1024 * 1024
export const MAX_RECORDS = limits.records_per_batch
export const MAX_RECORD_BYTES = limits.record_bytes
export const MAX_BATCH_BYTES = limits.batch_bytes
// Batches are cut at half the limit so one full-size record still fits beside the others.
export const BATCH_TARGET_BYTES = MAX_BATCH_BYTES / 2
export const encodedSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
// One batch carries one target: same service, project, environment and site.
export const groupKey = (value: Destination) => JSON.stringify([value.serviceUrl, value.projectId, value.environment, value.site ?? null])
