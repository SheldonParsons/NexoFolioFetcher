// Internal capture context. Wire projection waits for the authoritative v3 bundle.
export interface EvidenceContext {
  browser_instance_id: string
  page_instance_id: string
  frame_instance_id: string
  view_id: string
  event_seq: number
  interaction_id?: string
  request_started_at_ms?: number
  response_completed_at_ms?: number
  page_url: string
}
export interface ContextSeed { browser_instance_id: string; page_instance_id: string; frame_instance_id: string; view_id: string }
export type EvidenceSample = {
  kind: 'page_context' | 'interaction' | 'ui_snapshot' | 'capability'
  context: EvidenceContext
  observed_at_ms: number
  data: Record<string, unknown>
}
export interface EvidenceOptions { nonce: string }
