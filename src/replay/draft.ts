import type { CaptureDetail, CapturedRequest } from '../capture/contracts'
import { validatePayload, type RequestPayload } from './contracts'
import { formatHeaderLines, parseHeaderLines, withContentType } from './headerLines'

export interface DraftPair { id: string; name: string; value: string; enabled: boolean; raw?: string }
export type BodyMode = 'none' | 'json' | 'text' | 'form' | 'base64' | 'unavailable'
export interface UrlDraft { base: string; fragment: string; emptyQuery: boolean; pairs: DraftPair[]; rawQuery?: string }
export interface RequestDraft {
  readonly method: string; url: UrlDraft; headersText: string; bodyMode: BodyMode; text: string; form: DraftPair[]
  credentials: 'omit' | 'include'; urlNeedsReplacement: boolean; bodyNote: string; headersNote: string
}
export const pair = (name = '', value = ''): DraftPair => ({ id: crypto.randomUUID(), name, value, enabled: true })
export const tooManyPairs = (value: string) => value.split('&', 257).length > 256
// Raw segments survive untouched edits, including repeated/empty keys, bare flags, + and %20.
export function parsePairs(value: string): DraftPair[] {
  if (!value) return []
  return value.split('&', 256).map(raw => {
    const separator = raw.indexOf('=')
    const decode = (text: string) => new URLSearchParams('value=' + text).get('value') || ''
    const name = decode(separator < 0 ? raw : raw.slice(0, separator))
    const value = separator < 0 ? '' : decode(raw.slice(separator + 1))
    return { ...pair(name, value), raw }
  })
}
export const encodePairs = (pairs: DraftPair[]) => pairs.filter(row => row.enabled)
  .map(row => row.raw ?? new URLSearchParams([[row.name, row.value]]).toString()).join('&')
export function parseUrl(text: string): UrlDraft {
  const hash = text.indexOf('#'), address = hash < 0 ? text : text.slice(0, hash)
  const question = address.indexOf('?'), query = question < 0 ? '' : address.slice(question + 1)
  return { base: question < 0 ? address : address.slice(0, question), fragment: hash < 0 ? '' : text.slice(hash), emptyQuery: question >= 0 && !query,
    pairs: tooManyPairs(query) ? [] : parsePairs(query), ...(tooManyPairs(query) ? { rawQuery: query } : {}) }
}
export function draftUrl(url: UrlDraft) {
  const query = url.rawQuery ?? encodePairs(url.pairs)
  return url.base + (query || url.emptyQuery || url.pairs.some(row => row.enabled) ? '?' + query : '') + url.fragment
}
export function createDraft(row: CapturedRequest, detail: CaptureDetail): RequestDraft {
  const input = detail.request
  if (!input) throw new Error('原始请求已不可用。')
  const body = input.body, contentType = body.contentType || input.headers.entries.find(([name]) => name.toLowerCase() === 'content-type')?.[1] || ''
  let mode: BodyMode = 'unavailable'
  if (body.state === 'none') mode = 'none'
  else if (body.state === 'complete' && !/multipart\/form-data/i.test(contentType)) {
    if (body.encoding === 'base64') mode = 'base64'
    else if (body.encoding === 'text') mode = /x-www-form-urlencoded/i.test(contentType) ? 'form' : /\bjson\b|\+json/i.test(contentType) ? 'json' : 'text'
    else if (!body.bytes) mode = 'none'
  }
  const largeForm = mode === 'form' && tooManyPairs(body.body)
  if (largeForm) mode = 'text'
  const headers = input.headers.entries.map(([name, value]): [string, string] => [name, value])
  const inferredType = mode !== 'none' && mode !== 'unavailable' && !!contentType && !headers.some(([name]) => name.toLowerCase() === 'content-type')
  if (inferredType) headers.push(['Content-Type', contentType])
  return {
    method: row.method, url: parseUrl(input.url), urlNeedsReplacement: input.urlTruncated,
    headersText: formatHeaderLines(headers, true),
    headersNote: [input.headers.state !== 'page-visible' ? input.headers.message || '原始 Header 未完整读取，请核对并补全。' : '',
      inferredType ? '草稿按采集正文类型补充了 Content-Type，可编辑或停用；原始 Headers 不变。' : ''].filter(Boolean).join(' '),
    bodyMode: mode, text: mode === 'unavailable' ? '' : body.body, form: mode === 'form' ? parsePairs(body.body) : [], credentials: 'omit',
    bodyNote: mode === 'unavailable' ? body.message || '原始正文尚未读完、已截断或无法恢复，请自行重建正文，或明确选择无正文。'
      : largeForm ? '表单超过 256 项，保留完整 URL 编码原文，请在文本编辑器中修改。' : '',
  }
}
export function setBodyMode(draft: RequestDraft, mode: BodyMode) {
  const previous = draft.bodyMode
  if (mode === 'form' && previous === 'text' && tooManyPairs(draft.text)) { draft.bodyNote = '表单超过 256 项，请保留原始文本方式编辑。'; return }
  draft.bodyMode = mode
  if (mode === 'form' && previous !== 'form' && !draft.form.length && draft.text && previous === 'text') draft.form = parsePairs(draft.text)
  const mediaTypes: Partial<Record<BodyMode, string>> = { json: 'application/json', text: 'text/plain;charset=UTF-8', form: 'application/x-www-form-urlencoded;charset=UTF-8', base64: 'application/octet-stream' }
  const contentType = mediaTypes[mode]
  if (contentType && mode !== previous) draft.headersText = withContentType(draft.headersText, contentType)
}
export function payloadFrom(draft: RequestDraft): RequestPayload {
  if (draft.urlNeedsReplacement) throw new Error('原始 URL 已截断，请在 URL 栏补全后再发送。')
  if (draft.bodyMode === 'unavailable') throw new Error('原始正文不可完整恢复，请重建正文或明确选择「无正文」。')
  if (draft.bodyMode === 'json') {
    try { JSON.parse(draft.text) } catch { throw new Error('JSON 正文无效，请修正内容，或切换为原始文本。') }
  }
  return validatePayload({
    method: draft.method, url: draftUrl(draft.url), headers: parseHeaderLines(draft.headersText),
    body: { mode: draft.bodyMode === 'none' ? 'none' : draft.bodyMode === 'base64' ? 'base64' : 'text',
      content: draft.bodyMode === 'none' ? '' : draft.bodyMode === 'form' ? encodePairs(draft.form) : draft.text }, credentials: draft.credentials,
  })
}
