// Internal capture context; upload/converter.ts projects it onto the collect v1 record context.
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
export function validObservedTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000
}
