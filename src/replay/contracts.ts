import type { CapturedResponse } from '../capture/contracts'
import type { PageTarget, SiteBinding } from '../platforms/contracts'

export const REPLAY_PORT = 'nexofolio-manual-request-v1'
export const REPLAY_BODY_LIMIT = 1024 * 1024
export const REPLAY_TIMEOUT = 25000
export interface RecordReference { id: number; recordKey: string; target: PageTarget }
export interface RequestPayload {
  url: string; method: string; headers: [string, string][]
  body: { mode: 'none' | 'text' | 'base64'; content: string }
  credentials: 'omit' | 'include'
}
export interface ReplayInspection {
  planId: string; url: string; origin: string; originalOrigin: string
  needsPermission: boolean; changedTarget: boolean; credentialsAllowed: boolean
  binding: SiteBinding | null
}
export interface ReplayResult {
  attemptId: string; state: 'response' | 'network-error' | 'timeout' | 'cancelled' | 'blocked'
  elapsedMs: number; startedAt: number; message: string
  response: CapturedResponse | null
}
export type ReplayMessage =
  | { type: 'hello'; protocol: string; windowId: number }
  | { type: 'inspect'; revision: number; reference: RecordReference; url: string }
  | { type: 'send'; attemptId: string; planId: string; request: RequestPayload; confirmedTarget: boolean }
  | { type: 'cancel'; attemptId: string }
  | { type: 'heartbeat' }
export type ReplayEvent =
  | { kind: 'ready' }
  | { kind: 'invalidated'; message: string }
  | { kind: 'inspection'; revision: number; inspection?: ReplayInspection; error?: string }
  | { kind: 'sending'; attemptId: string }
  | { kind: 'result'; result: ReplayResult }

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
// Fetch controls these values, or Chrome silently drops them. Keep them visible but disabled.
const managedHeaders = new Set(['accept-charset', 'accept-encoding', 'access-control-request-headers',
  'access-control-request-method', 'connection', 'content-length', 'cookie', 'cookie2', 'date', 'dnt',
  'expect', 'host', 'keep-alive', 'origin', 'permissions-policy', 'referer', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'via', 'user-agent', 'set-cookie', 'set-cookie2'])
export function browserManagedHeader(name: string, value = '') {
  const key = name.trim().toLowerCase()
  return managedHeaders.has(key) || key.startsWith('sec-') || key.startsWith('proxy-')
    || ['x-http-method', 'x-http-method-override', 'x-method-override'].includes(key) && /\b(CONNECT|TRACE|TRACK)\b/i.test(value)
}
export function requestUrl(value: string): URL {
  if (typeof value !== 'string' || value.length > 65536 || /[\u0000-\u0020\u007f]/.test(value)) throw new Error('请输入有效 URL，空格须编码，最多 64 KiB。')
  let url: URL
  try { url = new URL(value) } catch { throw new Error('请输入完整的 HTTP / HTTPS URL。') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('仅支持 HTTP / HTTPS；URL 不可包含账号、密码或 # 片段。')
  return url
}
export function validatePayload(value: unknown): RequestPayload {
  if (!value || typeof value !== 'object') throw new Error('请求草稿不完整。')
  const request = value as RequestPayload
  requestUrl(request.url)
  if (!METHODS.includes(request.method as typeof METHODS[number])) throw new Error('不支持此请求方法。')
  if (!['omit', 'include'].includes(request.credentials)) throw new Error('凭据选项无效。')
  if (!Array.isArray(request.headers) || request.headers.length > 256) throw new Error('请求 Header 最多 256 项。')
  let size = 0
  for (const pair of request.headers) {
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some(item => typeof item !== 'string')) throw new Error('Header 格式无效。')
    const [name, value] = pair
    if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(name) || /[\u0000-\u0008\u000a-\u001f\u007f\u0100-\uffff]/.test(value)) throw new Error('Header 名称或值含浏览器不支持的字符。')
    if (browserManagedHeader(name, value)) throw new Error('请停用浏览器管理的 Header；Cookie 请使用凭据选项。')
    size += name.length + value.length
  }
  if (size > 65536) throw new Error('请求 Header 超过 64 KiB。')
  const body = request.body
  if (!body || !['none', 'text', 'base64'].includes(body.mode) || typeof body.content !== 'string' || body.content.length > REPLAY_BODY_LIMIT * 2) throw new Error('请求正文格式或大小无效。')
  if (body.mode === 'none' && body.content) throw new Error('无正文模式不可携带内容。')
  if (['GET', 'HEAD'].includes(request.method) && body.mode !== 'none') throw new Error('GET / HEAD 不发送正文，请明确选择「无正文」。')
  let bytes = 0
  if (body.mode === 'text') bytes = new TextEncoder().encode(body.content).length
  if (body.mode === 'base64') {
    try { bytes = atob(body.content).length } catch { throw new Error('二进制正文不是有效 Base64。') }
  }
  if (bytes > REPLAY_BODY_LIMIT) throw new Error('请求正文最多 1 MiB。')
  return request
}
