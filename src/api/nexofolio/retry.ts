// Retry-After is a floor. Invalid/expired values use the ordinary bounded backoff.
export function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined
  const text = value.trim()
  const delay = /^\d+$/.test(text) ? Number(text) * 1000
    : /^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{6,9}, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \d{4})$/.test(text) ? Date.parse(text.endsWith('GMT') ? text : text + ' GMT') - now : NaN
  return Number.isFinite(delay) && delay > 0 && Number.isSafeInteger(now + delay) ? delay : undefined
}

export function retryDelay(attempts: number, serverDelay = 0, random = Math.random()): number {
  const cap = Math.min(60000, 1000 * 2 ** Math.min(attempts, 6))
  // Equal jitter keeps a nonzero floor offline; positive server jitter never
  // shortens an authoritative wait, including waits longer than one minute.
  const jitter = Math.max(0, Math.min(1, random))
  return Math.ceil(Math.max(serverDelay, cap / 2) + jitter * cap / 2)
}
