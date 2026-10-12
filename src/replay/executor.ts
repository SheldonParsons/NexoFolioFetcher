import type { CapturedResponse } from '../capture/contracts'
import { REPLAY_BODY_LIMIT, type RequestPayload } from './contracts'

export function bodyBytes(request: RequestPayload): BodyInit | undefined {
  if (request.body.mode === 'none') return undefined
  if (request.body.mode === 'text') return request.body.content
  return Uint8Array.from(atob(request.body.content), char => char.charCodeAt(0))
}
function encode(bytes: Uint8Array, contentType: string) {
  if (!contentType || /text\/|json|xml|javascript|urlencoded|graphql|yaml|svg/i.test(contentType)) {
    let decoder: TextDecoder
    try { decoder = new TextDecoder(contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] || 'utf-8') } catch { decoder = new TextDecoder() }
    return { body: decoder.decode(bytes), encoding: 'text' as const }
  }
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return { body: btoa(binary), encoding: 'base64' as const }
}
// Only extension background fetch. No page injection, capture hook, upload or NexoFolio client.
export async function executeRequest(request: RequestPayload, signal: AbortSignal): Promise<CapturedResponse> {
  const headers = new Headers()
  for (const [name, value] of request.headers) headers.append(name, value)
  const response = await fetch(request.url, { method: request.method, headers, body: bodyBytes(request),
    credentials: request.credentials, redirect: 'manual', cache: 'no-store', referrerPolicy: 'no-referrer', signal })
  const result: CapturedResponse = { status: response.status || null, statusText: response.statusText.slice(0, 128), url: request.url,
    state: 'complete', body: '', encoding: 'none', bytes: 0, contentType: response.headers.get('content-type') || '', message: '',
    headers: { entries: [], state: 'page-visible', message: 'Fetch 可读取的响应头；不包含被浏览器隐藏的 Set-Cookie。' } }
  let headerSize = 0
  for (const [name, value] of response.headers) {
    if (headerSize + name.length + value.length > 65536 || result.headers.entries.length >= 256) {
      result.headers.state = 'truncated'; result.headers.message = '响应 Header 超过 64 KiB / 256 项，显示已截断。'; break
    }
    headerSize += name.length + value.length; result.headers.entries.push([name, value])
  }
  if (response.type === 'opaqueredirect' || response.type === 'opaque') {
    result.state = 'unreadable'; result.message = '浏览器隐藏了此响应；未自动跟随重定向。'; return result
  }
  if (!response.body) return result
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let timeout = false, finished = false
  const timer = setTimeout(() => { timeout = true; void reader.cancel().catch(() => {}) }, 15000)
  try {
    while (!signal.aborted) {
      const next = await reader.read()
      if (next.done) { finished = true; break }
      const room = REPLAY_BODY_LIMIT - result.bytes
      chunks.push(next.value.subarray(0, room)); result.bytes += Math.min(room, next.value.length)
      if (next.value.length > room) { result.state = 'truncated'; result.message = '响应超过 1 MiB，仅展示已读取部分。'; void reader.cancel().catch(() => {}); break }
    }
  } catch { result.state = 'unreadable'; result.message = '响应正文读取中断，保留已读取部分。' }
  finally { clearTimeout(timer) }
  if (timeout) { result.state = 'timeout'; result.message = '响应正文读取超过 15 秒，保留已读取部分。' }
  else if (signal.aborted) { result.state = 'unreadable'; result.message = '已停止读取响应，保留已读取部分；服务端可能已执行。' }
  else if (!finished && result.state === 'complete') result.state = 'unreadable'
  const bytes = new Uint8Array(result.bytes)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return { ...result, ...encode(bytes, result.contentType) }
}
