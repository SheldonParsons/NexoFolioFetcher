export interface CapturedRequest {
  id: number
  url: string
  method: string
  type: 'XHR' | 'Fetch'
  time: number
  frame: 'page' | 'iframe'
  response: ResponseSummary
  upload?: import('../upload/contracts').ObservationUploadState
  revision: number
}
export type ResponseState = 'pending' | 'reading' | 'complete' | 'truncated' | 'unreadable' | 'failed' | 'timeout'
export interface ResponseSummary {
  state: ResponseState
  status: number | null
  statusText: string
  contentType: string
  url: string
  encoding: 'text' | 'base64' | 'none'
  bytes: number
  message: string
}
export interface CapturedHeaders { entries: [string, string][]; state: 'page-visible' | 'truncated' | 'unreadable'; message: string }
export interface CapturedBody { state: 'none' | 'reading' | 'complete' | 'truncated' | 'unreadable' | 'timeout'; encoding: 'text' | 'base64' | 'none'; body: string; bytes: number; contentType: string; message: string }
export interface CapturedInput { url: string; urlTruncated: boolean; headers: CapturedHeaders; body: CapturedBody }
export interface CapturedResponse extends ResponseSummary { body: string; headers: CapturedHeaders }
export interface CaptureDetail { kind: 'detail'; id: number; request: CapturedInput | null; response: CapturedResponse | null }
export interface CaptureSnapshot {
  status: 'idle' | 'checking' | 'listening' | 'stopped' | 'interrupted' | 'error'
  message: string
  rows: CapturedRequest[]
  upload?: import('../upload/contracts').QueueStatus
}
export const CAPTURE_PORT = 'nexofolio-capture-v3'
export const PAGE_RELAY_PORT = 'nexofolio-page-relay-v3'
export const CAPTURE_LIMIT = 20
export const BODY_LIMIT = 1024 * 1024
export const BODY_TIMEOUT = 15000
export interface CaptureScope { origin: string; prefix: string; excludedPrefixes: string[] }
export interface PageCaptureOptions {
  contextSeed?: import('../evidence/context').ContextSeed
  credits?: number
  scope?: CaptureScope
  nonce: string
  url: string
  maxBytes: number
  maxRows: number
  bodyTimeout: number
  requestTimeout: number
  leaseMs: number
  relayPort: string
}
