import type { CapturedInput, CapturedResponse } from '../capture/contracts'
import type { IngestionBatch as IngestionBatchV1 } from '../contracts/ingestion/legacy/v1/types.generated'
import type { IngestionBatch, Record as IngestionRecord } from '../contracts/ingestion/types.generated'
export interface Destination { serviceUrl: string; userId: string; projectId: string; environment: { id: string } | { name: string } }
import type { CaptureRecord, CaptureBatch } from '../contracts/capture/types.generated'
export type QueueRecord = IngestionRecord | CaptureRecord
export type CaptureWireBatch = Omit<CaptureBatch, 'records'> & { records: QueueRecord[] }
export interface Observation { context?: import('../evidence/context').EvidenceContext; request: CapturedInput; response: CapturedResponse; method: string; time: number; sourcePage: string; transport: 'xhr' | 'fetch'; frame: 'page' | 'iframe' }
export type UploadBatch = IngestionBatch | IngestionBatchV1 | CaptureWireBatch
export interface QueueItem { wireVersion?: '1' | '2' | '3'; id: string; destination: Destination; observation?: Observation; createdAt: number; size: number; state: 'draft' | 'ready' | 'batched' | 'failed'; record?: QueueRecord; assetId?: string; failure?: string }
export interface QueueBatch { id: string; destination: Destination; itemIds: string[]; wire: UploadBatch; attempts: number; nextAttempt: number }
export interface QueueStatus { pending: number; failed: number; bytes: number; paused: boolean; message: string; failures: { reason: string; count: number }[] }
export const MAX_QUEUE_BYTES = 256 * 1024 * 1024
export const MAX_QUEUE_ITEMS = 5000
export const RESERVATION_BYTES = 48 * 1024 * 1024
export const MAX_RECORD_BYTES = 4 * 1024 * 1024
export const MAX_BATCH_BYTES = 8 * 1024 * 1024
export const encodedSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
export const destinationKey = (value: Destination) => JSON.stringify([value.serviceUrl,value.userId,value.projectId,value.environment])

export const legacyService = (destination: Destination) => { const value = Reflect.get(destination, 'serviceKey'); return typeof value === 'string' ? value : 'default' }
export const itemGroupKey = (item: QueueItem) => JSON.stringify([item.wireVersion || '1', destinationKey(item.destination), (item.wireVersion || '1') === '1' ? legacyService(item.destination) : null])

export interface ObservationUploadState { state: 'collecting' | 'queued' | 'sending' | 'confirmed' | 'failed'; message: string }

export interface QueueAsset { id: string; destination: Destination; bytes: Uint8Array; size: number; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; sha256: string; state: 'pending' | 'uploaded' | 'failed'; nextAttempt: number; attempts: number; failure?: string }
