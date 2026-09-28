import type { EvidenceContext } from '../evidence/context'
import type { PageCaptureOptions, CapturedHeaders, CapturedBody, CapturedInput } from './contracts'

// Serialized by chrome.scripting into MAIN. Keep every runtime dependency inside this function.
export function installPageCapture(options: PageCaptureOptions) {
  const host = window as unknown as Record<string, unknown>
  const slot = '__asynctest_page_capture_v2__'
  const previous = host[slot] as { stop?: () => void } | undefined
  try { previous?.stop?.() } catch { /* The page may have replaced the old marker. */ }
  const nativePush = history.pushState, nativeReplace = history.replaceState
  const nativeFetch = window.fetch
  const NativeXHR = window.XMLHttpRequest
  const nativeOpen = NativeXHR.prototype.open
  const nativeSend = NativeXHR.prototype.send
  const nativeSetHeader = NativeXHR.prototype.setRequestHeader
  const nativeGetHeaders = NativeXHR.prototype.getAllResponseHeaders
  const nativeRequestClone = Request.prototype.clone
  const nativeThen = Promise.prototype.then
  const nativeClone = Response.prototype.clone
  const nativePost = window.postMessage.bind(window)
  const setTimer = window.setTimeout.bind(window)
  const clearTimer = window.clearTimeout.bind(window)
  const now = Date.now.bind(Date)
  const addEvent = EventTarget.prototype.addEventListener
  const removeEvent = EventTarget.prototype.removeEventListener
  const fetchDescriptor = Object.getOwnPropertyDescriptor(window, 'fetch')
  const openDescriptor = Object.getOwnPropertyDescriptor(NativeXHR.prototype, 'open')
  const sendDescriptor = Object.getOwnPropertyDescriptor(NativeXHR.prototype, 'send')
  const headerDescriptor = Object.getOwnPropertyDescriptor(NativeXHR.prototype, 'setRequestHeader')
  const encoder = new TextEncoder()
  const records = new Map<string, { id: string; done: boolean; live: boolean; timer: number; cancel: () => void; cleanup: () => void; requestCancel: () => void; requestTimer: number; requestDone: boolean; context: EvidenceContext }>()
  const xhrMetadata = new WeakMap<XMLHttpRequest, { url: string; method: string; sent: boolean; headers: CapturedHeaders; record?: ReturnType<typeof start> }>()
  let accepting = true
  const subscribers = new Set<(type: string, target?: Element, trusted?: boolean) => void>()
  let viewId = options.contextSeed?.view_id || crypto.randomUUID(), lastUrl = location.href, eventSequence = 0
  // Event.eventPhase returns to NONE after dispatch. Retain no sticky operation ID
  // across timers, polling or promises; nested dispatches can return to the outer event.
  let interactions: { event: Event; id: string }[] = []
  const activeInteraction = () => {
    interactions = interactions.filter(item => item.event.eventPhase !== 0)
    return interactions.at(-1)?.id
  }
  const context = (): EvidenceContext => {
    if (lastUrl !== location.href) { lastUrl = location.href; viewId = crypto.randomUUID(); eventSequence = 0; for (const fn of subscribers) fn('route') }
    const interactionId = activeInteraction()
    return { browser_instance_id: options.contextSeed?.browser_instance_id || options.nonce, page_instance_id: options.contextSeed?.page_instance_id || options.nonce, frame_instance_id: options.contextSeed?.frame_instance_id || options.nonce, view_id: viewId, event_seq: ++eventSequence, page_url: lastUrl, ...(interactionId ? { interaction_id: interactionId } : {}) }
  }
  const interaction = (event: Event) => {
    if (!allowed()) return
    const element = event.target instanceof Element ? event.target : undefined
    const selector = event.type === 'submit' ? 'form,[role="form"],.el-form,.ant-form,.ivu-form,.n-form,.arco-form'
      : 'input,textarea,select,button,a[href],[role="button"],[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"],[role="option"],[role="menuitem"],[role="tab"],.el-button,.ant-btn,.ivu-btn,.n-button,.arco-btn,.el-select,.ant-select,.ivu-select,.n-base-selection,.arco-select,.el-select-dropdown__item,.ant-select-item-option,.ivu-select-item,.arco-select-option'
    let target: Element | undefined, current = element
    for (let depth = 0; current && depth <= 6; depth++, current = current.parentElement || undefined) {
      if (current.matches(selector)) { target = current; break }
    }
    if (!target) return
    context()
    interactions.push({ event, id: crypto.randomUUID() })
    // A bounded stack avoids retaining arbitrary page events. Observation must
    // never throw through the site's own event handler.
    if (interactions.length > 16) interactions.shift()
    for (const fn of subscribers) { try { fn(event.type, target, event.isTrusted) } catch {} }
  }
  const route = () => { if (allowed()) context() }
  let enabled = true
  let sequence = 0
  let credits = options.credits ?? 0
  let readers = 0
  let leaseTimer = 0
  let fetchInstalled = false
  let xhrInstalled = false

  function allowed() {
    if (!enabled || !accepting) return false
    const scope = options.scope
    const matches = (prefix: string) => prefix === '/' || location.pathname === prefix || location.pathname.startsWith(prefix + '/')
    const inScope = scope ? location.origin === scope.origin && matches(scope.prefix) && !scope.excludedPrefixes.some(matches) : location.href === options.url
    if (!inScope || document.visibilityState === 'hidden') { suspend(); return false }
    return true
  }
  function emit(payload: object) {
    if (!enabled) return
    if (('kind' in payload && (payload.kind === 'request' || payload.kind === 'capacity')) && !allowed()) return
    try { nativePost({ direction: 'fetcher-data-v2', nonce: options.nonce, payload }, '*') } catch { /* Observation must not fail the application request. */ }
  }
  function isCurrent(record: ReturnType<typeof start>) { return !!record && !record.done && records.get(record.id) === record && enabled }
  function disposeRecord(record: NonNullable<ReturnType<typeof start>>) {
    record.live = false
    record.done = true
    clearTimer(record.requestTimer)
    record.requestCancel()
    clearTimer(record.timer)
    record.cancel()
    record.cleanup()
  }
  function finish(record: ReturnType<typeof start>, response: Record<string, unknown>) {
    if (!isCurrent(record) || !record) return
    emit({ kind: 'response', requestId: record.id, context: { ...record.context, ...(['complete','failed'].includes(String(response.state)) ? { response_completed_at_ms: now() } : {}) }, response })
    record.done = true
    clearTimer(record.timer)
    record.cancel()
    record.cleanup()
    if (record.requestDone) records.delete(record.id)
  }
  function unavailable(record: ReturnType<typeof start>, state: string, message: string) {
    finish(record, { state, status: null, statusText: '', contentType: '', url: '', encoding: 'none', bytes: 0, body: '', message, headers: { entries: [], state: 'unreadable', message: '没有可读取的响应头。' } })
  }
  function start(url: string, method: string, type: 'XHR' | 'Fetch', request: CapturedInput) {
    if (!allowed() || !/^https?:\/\//i.test(url)) return null
    if (credits <= 0) { emit({ kind: 'capacity' }); return null }
    credits--
    const id = String(++sequence)
    const record = { id, done: false, live: true, timer: 0, cancel: () => {}, cleanup: () => {}, requestCancel: () => {}, requestTimer: 0, requestDone: false, context: { ...context(), request_started_at_ms: now() } as EvidenceContext }
    records.set(id, record)
    record.timer = setTimer(() => unavailable(record, 'timeout', '30 秒内未收到可读取响应；原请求未被中止。'), options.requestTimeout)
    emit({ kind: 'request', requestId: id, url: url.slice(0, 16384), method: method.slice(0, 32), type, time: record.context.request_started_at_ms, context: record.context, request })
    return record
  }
  function absoluteUrl(value: unknown): string {
    try {
      if (typeof value === 'string') return new URL(value, document.baseURI).href
      if (value instanceof URL) return value.href
      if (value instanceof Request) return value.url
    } catch {}
    return '' // Don't coerce arbitrary objects or invoke their toString a second time.
  }
  function textBytes(text: string) {
    const prefix = text.slice(0, options.maxBytes)
    const bytes = encoder.encode(prefix)
    return { bytes: bytes.subarray(0, options.maxBytes), truncated: prefix.length < text.length || bytes.byteLength > options.maxBytes }
  }
  function encodeBody(bytes: Uint8Array, contentType: string, forceText = false) {
    if (forceText || !contentType || /(?:text\/|json|xml|javascript|x-www-form-urlencoded|graphql|yaml|svg)/i.test(contentType)) {
      let decoder: TextDecoder
      try { decoder = new TextDecoder(forceText ? 'utf-8' : contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] || 'utf-8') } catch { decoder = new TextDecoder() }
      return { encoding: 'text', body: decoder.decode(bytes, { stream: true }) }
    }
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
    return { encoding: 'base64', body: btoa(binary) }
  }
  function limitedJson(value: unknown) {
    const pieces: string[] = []
    let size = 0, nodes = 0, truncated = false
    const ancestors = new Set<object>()
    const limit = Symbol('limit')
    function append(text: string) {
      const remaining = options.maxBytes - size
      pieces.push(text.slice(0, remaining)); size += Math.min(text.length, remaining)
      if (text.length > remaining) throw limit
    }
    function write(item: unknown, depth: number) {
      if (++nodes > 20000 || depth > 40) throw limit
      if (item === null) { append('null'); return }
      if (typeof item === 'string') {
        const remaining = Math.max(0, options.maxBytes - size)
        append(JSON.stringify(item.slice(0, remaining)))
        if (item.length > remaining) throw limit
        return
      }
      if (typeof item === 'number' || typeof item === 'boolean') { append(JSON.stringify(item)); return }
      if (typeof item !== 'object') { append('null'); return }
      if (ancestors.has(item)) throw new Error('响应对象包含循环引用')
      ancestors.add(item)
      if (Array.isArray(item)) {
        append('[')
        for (let i = 0; i < item.length; i++) { if (i) append(','); write(item[i], depth + 1) }
        append(']')
      } else {
        append('{'); let first = true
        for (const key in item) {
          const descriptor = Object.getOwnPropertyDescriptor(item, key)
          if (!descriptor) continue
          if (!('value' in descriptor)) throw new Error('响应对象已被页面修改')
          if (!first) append(','); first = false
          append(JSON.stringify(key.slice(0, options.maxBytes - size))); append(':'); write(descriptor.value, depth + 1)
        }
        append('}')
      }
      ancestors.delete(item)
    }
    try { write(value, 0) } catch (error) { if (error === limit) truncated = true; else throw error }
    const encoded = textBytes(pieces.join(''))
    return { bytes: encoded.bytes, truncated: truncated || encoded.truncated }
  }
  function headersFrom(value: unknown, response = false): CapturedHeaders {
    const result: CapturedHeaders = { entries: [], state: 'page-visible', message: response
      ? '仅页面可见的响应头；不包含 Set-Cookie，跨域响应受暴露规则限制。'
      : '仅页面设置或 Request 中可见的请求头；不代表浏览器最终发送的完整请求头。' }
    let size = 0
    const add = (name: unknown, value: unknown) => {
      if (typeof name !== 'string' || typeof value !== 'string') { result.state = 'unreadable'; return false }
      if (result.entries.length >= 256 || size + name.length + value.length > 65536) { result.state = 'truncated'; return false }
      result.entries.push([name, value]); size += name.length + value.length; return true
    }
    try {
      if (value instanceof Headers) { for (const [name, item] of value.entries()) if (!add(name, item)) break }
      else if (Array.isArray(value)) { for (const pair of value) { if (!Array.isArray(pair)) { result.state = 'unreadable'; break }; if (!add(pair[0], pair[1])) break } }
      else if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
        for (const name in value) {
          const descriptor = Object.getOwnPropertyDescriptor(value, name)
          if (!descriptor) continue
          if (!('value' in descriptor) || !add(name, descriptor.value)) { result.state = 'unreadable'; break }
        }
      } else if (value != null) result.state = 'unreadable'
    } catch { result.state = 'unreadable' }
    if (result.state === 'truncated') result.message = '请求/响应头超过 256 项或 64 KiB，仅保留前段。' + result.message
    if (result.state === 'unreadable') result.message = '部分头字段无法在不重复调用页面转换逻辑的情况下读取。' + result.message
    return result
  }
  function ownOption(init: unknown, name: string) {
    if (!init || typeof init !== 'object') return { found: false, readable: true, value: undefined }
    if (!(name in init)) return { found: false, readable: true, value: undefined }
    const descriptor = Object.getOwnPropertyDescriptor(init, name)
    return descriptor && 'value' in descriptor ? { found: true, readable: true, value: descriptor.value } : { found: true, readable: false, value: undefined }
  }
  function blankBody(state: CapturedBody['state'], message = ''): CapturedBody {
    return { state, encoding: 'none', bytes: 0, contentType: '', body: '', message }
  }
  function requestAlive(record: ReturnType<typeof start>) { return !!record && record.live && !record.requestDone && records.get(record.id) === record && enabled }
  function finishRequest(record: ReturnType<typeof start>, body: CapturedBody) {
    if (!record || !requestAlive(record)) return
    emit({ kind: 'request-body', requestId: record.id, body })
    record.requestDone = true
    clearTimer(record.requestTimer)
    record.requestCancel()
    if (record.done) records.delete(record.id)
  }
  async function captureBody(record: ReturnType<typeof start>, value: unknown, contentType: string, requestCopy = false) {
    if (!record || !requestAlive(record)) return
    const done = (bytes: Uint8Array, truncated: boolean, forceText = false, message = '') => finishRequest(record, {
      ...encodeBody(bytes, contentType, forceText) as Pick<CapturedBody, 'body' | 'encoding'>,
      state: truncated ? 'truncated' : 'complete', bytes: bytes.byteLength, contentType,
      message: (truncated ? '请求正文超过采集上限，仅保留前 1 MiB。' : '') + message,
    })
    try {
      if (value == null) { finishRequest(record, blankBody('none')); return }
      if (typeof value === 'string') { const result = textBytes(value); done(result.bytes, result.truncated, true); return }
      if (value instanceof URLSearchParams) { const result = textBytes(value.toString()); done(result.bytes, result.truncated, true, 'URL 编码表单。'); return }
      if (value instanceof FormData) {
        const fields: object[] = []
        let size = 0, truncated = false, files = false
        for (const [name, item] of value.entries()) {
          if (size >= options.maxBytes || fields.length >= 1000) { truncated = true; break }
          const key = name.slice(0, Math.max(0, options.maxBytes - size)); size += key.length
          if (typeof item === 'string') {
            const text = item.slice(0, Math.max(0, options.maxBytes - size)); size += text.length
            fields.push({ name: key, value: text })
            if (key.length !== name.length || text.length !== item.length) { truncated = true; break }
          } else { files = true; fields.push({ name: key, file: item.name.slice(0, 1024), size: item.size, type: item.type.slice(0, 256) }); size += 1400 }
        }
        const result = textBytes(JSON.stringify(fields, null, 2))
        const body: CapturedBody = { ...encodeBody(result.bytes, '', true) as Pick<CapturedBody, 'body' | 'encoding'>, state: truncated || result.truncated ? 'truncated' : files ? 'unreadable' : 'complete', bytes: result.bytes.byteLength, contentType: 'multipart/form-data', message: '表单字段结构，保留重复字段；不是原始 multipart 字节。' + (files ? '文件只显示名称、大小和类型，未读取文件内容。' : '') + (truncated || result.truncated ? '字段已截断。' : '') }
        finishRequest(record, body); return
      }
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        contentType ||= 'application/octet-stream'
        const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        done(bytes.subarray(0, options.maxBytes).slice(), bytes.byteLength > options.maxBytes); return
      }
      if (value instanceof Blob) {
        contentType ||= value.type || 'application/octet-stream'
        contentType = contentType.slice(0, 256)
        if (readers >= 6) { finishRequest(record, blankBody('unreadable', '正文采集并发已满。')); return }
        readers++
        try {
          record.requestTimer = setTimer(() => finishRequest(record, blankBody('timeout', '请求正文读取超过 15 秒。')), options.bodyTimeout)
          done(new Uint8Array(await value.slice(0, options.maxBytes).arrayBuffer()), value.size > options.maxBytes)
        } finally { readers-- }
        return
      }
      if (requestCopy && value instanceof Request) {
        if (!value.body) { finishRequest(record, blankBody('none')); return }
        if (readers >= 6) { void value.body.cancel().catch(() => {}); finishRequest(record, blankBody('unreadable', '正文采集并发已满。')); return }
        readers++
        const reader = value.body.getReader()
        record.requestCancel = () => { void reader.cancel().catch(() => {}) }
        let timedOut = false, truncated = false, size = 0
        const chunks: Uint8Array[] = []
        record.requestTimer = setTimer(() => { timedOut = true; record.requestCancel() }, options.bodyTimeout)
        try {
          while (requestAlive(record)) {
            const next = await reader.read()
            if (next.done) break
            const chunk = next.value.subarray(0, options.maxBytes - size).slice()
            chunks.push(chunk); size += chunk.byteLength
            if (size >= options.maxBytes) { truncated = true; record.requestCancel(); break }
          }
          const bytes = new Uint8Array(size); let offset = 0
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
          if (timedOut) finishRequest(record, { ...encodeBody(bytes, contentType) as Pick<CapturedBody, 'body' | 'encoding'>, state: 'timeout', bytes: size, contentType, message: '请求正文读取超时，仅保留已读取部分。' })
          else done(bytes, truncated)
        } finally { readers--; clearTimer(record.requestTimer) }
        return
      }
      finishRequest(record, blankBody('unreadable', '该请求正文类型暂不可读取；不会消费原始上传流或重复转换页面对象。'))
    } catch { finishRequest(record, blankBody('unreadable', '请求正文副本不可读取。')) }
  }
  async function observeFetch(record: ReturnType<typeof start>, response: Response) {
    if (!isCurrent(record) || !record) return
    const meta = { headers: headersFrom(response.headers, true), status: response.status, statusText: response.statusText.slice(0, 128), contentType: (response.headers.get('content-type') || '').slice(0, 256), url: response.url.slice(0, 16384) }
    if (response.type === 'opaque' || response.type === 'opaqueredirect') {
      finish(record, { ...meta, state: 'unreadable', encoding: 'none', bytes: 0, body: '', message: '不透明响应（opaque），页面本身无权读取正文。' }); return
    }
    if (!response.body) { finish(record, { ...meta, state: 'complete', encoding: 'text', bytes: 0, body: '', message: '' }); return }
    if (readers >= 6) { finish(record, { ...meta, state: 'unreadable', encoding: 'none', bytes: 0, body: '', message: '正文采集并发达到上限，本次未复制正文。' }); return }
    readers++
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const chunks: Uint8Array[] = []
    let size = 0, timedOut = false, truncated = false
    let timer = 0
    try {
      const copy = nativeClone.call(response)
      reader = copy.body!.getReader()
      const cancel = () => { try { void reader?.cancel().catch(() => {}) } catch {} }
      record.cancel = cancel
      clearTimer(record.timer)
      emit({ kind: 'response', requestId: record.id, response: { ...meta, state: 'reading', encoding: 'none', bytes: 0, body: '', message: '' } })
      timer = setTimer(() => { timedOut = true; cancel() }, options.bodyTimeout)
      while (isCurrent(record)) {
        const result = await reader.read()
        if (result.done) break
        const remaining = options.maxBytes - size
        const chunk = result.value.subarray(0, remaining)
        chunks.push(chunk.slice()); size += chunk.byteLength
        if (result.value.byteLength > remaining || size >= options.maxBytes) { truncated = true; cancel(); break }
      }
      if (!isCurrent(record)) return
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      finish(record, { ...meta, ...encodeBody(bytes, meta.contentType), bytes: size,
        state: timedOut ? 'timeout' : truncated ? 'truncated' : 'complete',
        message: timedOut ? '正文读取超过 15 秒，保留已读取部分；原请求继续。' : truncated ? '达到 1 MiB 上限，仅保留响应前段。' : '' })
    } catch {
      if (isCurrent(record)) {
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
        finish(record, { ...meta, ...encodeBody(bytes, meta.contentType), state: timedOut ? 'timeout' : 'unreadable', bytes: size, message: timedOut ? '正文读取超时，仅保留已读取部分；原请求未被中止。' : '响应副本读取失败，仅保留已读取部分。' })
      }
    } finally { clearTimer(timer); readers--; record.cancel = () => {} }
  }
  const wrappedPush: History['pushState'] = function(this: History, ...args) { const result = Reflect.apply(nativePush, this, args); route(); return result }
  const wrappedReplace: History['replaceState'] = function(this: History, ...args) { const result = Reflect.apply(nativeReplace, this, args); route(); return result }
  const wrappedFetch = function(this: unknown, ...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    let record: ReturnType<typeof start> = null
    try {
      if (allowed()) {
        const input = args[0], init = args[1]
        const base = input instanceof Request ? input : null
        const methodOption = ownOption(init, 'method'), headerOption = ownOption(init, 'headers'), bodyOption = ownOption(init, 'body')
        const method = methodOption.readable && typeof methodOption.value === 'string' ? methodOption.value : base?.method || 'GET'
        const headers = headersFrom(headerOption.found && headerOption.value !== undefined ? headerOption.value : base?.headers)
        if (!headerOption.readable) { headers.state = 'unreadable'; headers.message = 'headers 使用动态属性，未重复调用其读取逻辑。' }
        const url = absoluteUrl(input)
        record = start(url, method.toUpperCase(), 'Fetch', { url: url.slice(0, options.maxBytes), urlTruncated: url.length > options.maxBytes, headers, body: blankBody('reading') })
        if (record) {
          const contentType = (headers.entries.find(([name]) => name.toLowerCase() === 'content-type')?.[1] || '').slice(0, 256)
          if (!bodyOption.readable) finishRequest(record, blankBody('unreadable', 'body 使用动态属性，未重复调用其读取逻辑。'))
          else if (bodyOption.found && bodyOption.value != null) void captureBody(record, bodyOption.value, contentType)
          else if (base?.body) {
            try { void captureBody(record, nativeRequestClone.call(base), contentType, true) }
            catch { finishRequest(record, blankBody('unreadable', 'Request 正文已使用或无法复制。')) }
          } else finishRequest(record, blankBody('none'))
        }
      }
    } catch { if (record) finishRequest(record, blankBody('unreadable', '请求参数无法读取。')) }
    let promise: ReturnType<typeof fetch>
    try { promise = Reflect.apply(nativeFetch, this, args) as ReturnType<typeof fetch> }
    catch (error) { unavailable(record, 'failed', 'fetch 未能发送。'); throw error }
    try {
      if (record) {
        const observed = record
        const observation = nativeThen.call(promise,
          (response: Response) => { void observeFetch(observed, response).catch(() => unavailable(observed, 'unreadable', '无法读取响应内容。')) },
          () => unavailable(observed, 'failed', '请求失败、被取消或受跨域限制。'))
        void nativeThen.call(observation, undefined, () => {})
      }
    } catch {}
    return promise
  }
  function xhrResponseMeta(xhr: XMLHttpRequest) {
    const rawHeaders = nativeGetHeaders.call(xhr) || ''
    const pairs = rawHeaders.split(/\r?\n/).filter(Boolean).map(line => { const index = line.indexOf(':'); return [line.slice(0, index).trim(), line.slice(index + 1).trim()] })
    return { headers: headersFrom(pairs, true), status: xhr.status, statusText: xhr.statusText.slice(0, 128), contentType: (xhr.getResponseHeader('content-type') || '').slice(0, 256), url: xhr.responseURL.slice(0, 16384) }
  }
  async function observeXhr(record: ReturnType<typeof start>, xhr: XMLHttpRequest) {
    if (!isCurrent(record) || !record) return
    clearTimer(record.timer)
    const meta = xhrResponseMeta(xhr)
    if (!xhr.status) { unavailable(record, 'failed', '请求失败、被取消或受跨域限制。'); return }
    let result: { bytes: Uint8Array; truncated: boolean }
    let forceText = false
    let message = ''
    try {
      if (xhr.responseType === '' || xhr.responseType === 'text') { result = textBytes(xhr.responseText); forceText = true }
      else if (xhr.responseType === 'json') { result = limitedJson(xhr.response); forceText = true; message = '由浏览器已解析的 JSON 对象序列化。' }
      else if (xhr.responseType === 'arraybuffer' && xhr.response instanceof ArrayBuffer) {
        result = { bytes: new Uint8Array(xhr.response, 0, Math.min(xhr.response.byteLength, options.maxBytes)), truncated: xhr.response.byteLength > options.maxBytes }
      } else if (xhr.responseType === 'blob' && xhr.response instanceof Blob) {
        if (readers >= 6) throw new Error('正文读取并发已满')
        readers++
        try {
          record.timer = setTimer(() => unavailable(record, 'timeout', '正文读取超时。'), options.bodyTimeout)
          const blob = xhr.response as Blob
          result = { bytes: new Uint8Array(await blob.slice(0, options.maxBytes).arrayBuffer()), truncated: blob.size > options.maxBytes }
        } finally { readers-- }
      } else { unavailable(record, 'unreadable', `暂不读取 ${xhr.responseType || '未知'} 类型的 XHR 正文。`); return }
      if (!isCurrent(record)) return
      finish(record, { ...meta, ...encodeBody(result.bytes, meta.contentType, forceText), bytes: result.bytes.byteLength, state: result.truncated ? 'truncated' : 'complete', message: result.truncated ? `响应已截断（最多 1 MiB）。${message}` : message })
    } catch { if (isCurrent(record)) finish(record, { ...meta, state: 'unreadable', encoding: 'none', bytes: 0, body: '', message: '页面响应不可读、已被修改，或采集资源不足。' }) }
  }
  const wrappedOpen = function(this: XMLHttpRequest, ...args: unknown[]) {
    const old = xhrMetadata.get(this)?.record
    const result = Reflect.apply(nativeOpen, this, args)
    if (old) { finishRequest(old, blankBody('unreadable', 'XHR 对象已被重新使用，请求正文采集停止。')); unavailable(old, 'unreadable', 'XHR 对象被页面重新使用，未能保留此前正文。'); disposeRecord(old) }
    try { xhrMetadata.set(this, { method: typeof args[0] === 'string' ? args[0].toUpperCase() : '', url: absoluteUrl(args[1]), sent: false, headers: headersFrom(undefined) }) } catch {}
    return result
  }
  const wrappedSetHeader = function(this: XMLHttpRequest, name: string, value: string) {
    const result = Reflect.apply(nativeSetHeader, this, [name, value])
    try {
      const meta = xhrMetadata.get(this)
      if (meta && !meta.sent) {
        if (typeof name !== 'string' || typeof value !== 'string') { meta.headers.state = 'unreadable'; meta.headers.message = '部分 XHR 头字段需要动态转换，未重复转换。' }
        else {
          const entries = meta.headers.entries
          if (entries.length >= 256 || entries.reduce((size, pair) => size + pair[0].length + pair[1].length, 0) + name.length + value.length > 65536) { meta.headers.state = 'truncated'; meta.headers.message = 'XHR 请求头超过采集上限。' }
          else entries.push([name, value])
        }
      }
    } catch {}
    return result
  }
  const wrappedSend = function(this: XMLHttpRequest, ...args: unknown[]) {
    let record: ReturnType<typeof start> = null
    try {
      const meta = xhrMetadata.get(this)
      if (meta && !meta.sent && allowed()) {
        meta.sent = true
        const headers: CapturedHeaders = { ...meta.headers, entries: meta.headers.entries.map(pair => [...pair] as [string, string]) }
        record = start(meta.url, meta.method, 'XHR', { url: meta.url.slice(0, options.maxBytes), urlTruncated: meta.url.length > options.maxBytes, headers, body: blankBody('reading') }); meta.record = record
        if (record) {
          const contentType = (headers.entries.find(([name]) => name.toLowerCase() === 'content-type')?.[1] || '').slice(0, 256)
          if (meta.method === 'GET' || meta.method === 'HEAD') finishRequest(record, blankBody('none', 'GET/HEAD 的 XHR 不发送正文。'))
          else void captureBody(record, args[0], contentType)
        }
        if (record) {
          const observed = record
          const receivedHeaders = () => {
            if (this.readyState !== 2 || !isCurrent(observed)) return
            try { emit({ kind: 'response', requestId: observed.id, response: { ...xhrResponseMeta(this), state: 'reading', encoding: 'none', bytes: 0, body: '', message: '' } }) } catch {}
          }
          addEvent.call(this, 'readystatechange', receivedHeaders)
          const done = () => { void observeXhr(observed, this).catch(() => unavailable(observed, 'unreadable', '无法读取 XHR 响应。')) }
          const failed = () => unavailable(observed, 'failed', '请求失败、被取消或受跨域限制。')
          addEvent.call(this, 'loadend', done)
          for (const event of ['error', 'abort', 'timeout']) addEvent.call(this, event, failed)
          record.cleanup = () => {
            removeEvent.call(this, 'loadend', done)
            removeEvent.call(this, 'readystatechange', receivedHeaders)
            for (const event of ['error', 'abort', 'timeout']) removeEvent.call(this, event, failed)
          }
        }
      }
    } catch { /* Send still calls the original method once. */ }
    try { return Reflect.apply(nativeSend, this, args) }
    catch (error) { unavailable(record, 'failed', 'XHR 未能发送。'); throw error }
  }
  function restore(object: object, key: string, wrapper: unknown, original: unknown, descriptor?: PropertyDescriptor) {
    try {
      if (Reflect.get(object, key) !== wrapper) return
      if (descriptor) Object.defineProperty(object, key, descriptor)
      else Reflect.set(object, key, original)
    } catch {}
  }
  function suspend() {
    accepting = false
    interactions = []
    for (const fn of subscribers) fn('stop')
    subscribers.clear()
  }
  function stop() {
    if (!enabled) return
    suspend()
    enabled = false
    clearTimer(leaseTimer)
    for (const record of records.values()) disposeRecord(record)
    records.clear()
    restore(window, 'fetch', wrappedFetch, nativeFetch, fetchDescriptor)
    restore(history, 'pushState', wrappedPush, nativePush); restore(history, 'replaceState', wrappedReplace, nativeReplace)
    restore(NativeXHR.prototype, 'open', wrappedOpen, nativeOpen, openDescriptor)
    restore(NativeXHR.prototype, 'send', wrappedSend, nativeSend, sendDescriptor)
    restore(NativeXHR.prototype, 'setRequestHeader', wrappedSetHeader, nativeSetHeader, headerDescriptor)
    removeEvent.call(window, 'message', control)
    removeEvent.call(window, 'pagehide', stop)
    for (const name of ['click','change','submit']) removeEvent.call(document, name, interaction, true)
    removeEvent.call(window, 'popstate', route); removeEvent.call(window, 'hashchange', route)
    if (host[slot] === controller) delete host[slot]
  }
  function renew() { clearTimer(leaseTimer); leaseTimer = setTimer(stop, options.leaseMs) }
  function control(event: Event) {
    const message = event as MessageEvent
    if (message.source !== window || message.data?.direction !== 'fetcher-control-v2' || message.data?.nonce !== options.nonce) return
    if (message.data.type === 'credit' && Number.isInteger(message.data.count) && message.data.count > 0 && message.data.count <= 2) credits += message.data.count
    else if (message.data.type === 'suspend') suspend()
    else if (message.data.type === 'stop') stop()
    else if (message.data.type === 'renew' && enabled) renew()
    else if (message.data.type === 'drop' && typeof message.data.requestId === 'string') {
      const record = records.get(message.data.requestId)
      if (record) { disposeRecord(record); records.delete(record.id) }
    }
  }
  const controller = { stop, context, accepting: allowed, subscribe(fn: (type: string, target?: Element, trusted?: boolean) => void) { subscribers.add(fn); return () => subscribers.delete(fn) }, nonce: options.nonce }
  try {
    Reflect.set(history,'pushState',wrappedPush); Reflect.set(history,'replaceState',wrappedReplace)
    fetchInstalled = typeof nativeFetch === 'function' && Reflect.set(window, 'fetch', wrappedFetch) && window.fetch === wrappedFetch
    xhrInstalled = Reflect.set(NativeXHR.prototype, 'open', wrappedOpen) && Reflect.set(NativeXHR.prototype, 'send', wrappedSend) && Reflect.set(NativeXHR.prototype, 'setRequestHeader', wrappedSetHeader)
    if (!xhrInstalled) {
      restore(NativeXHR.prototype, 'open', wrappedOpen, nativeOpen, openDescriptor)
      restore(NativeXHR.prototype, 'send', wrappedSend, nativeSend, sendDescriptor)
      restore(NativeXHR.prototype, 'setRequestHeader', wrappedSetHeader, nativeSetHeader, headerDescriptor)
    }
    host[slot] = controller
    addEvent.call(window, 'message', control)
    addEvent.call(window, 'pagehide', stop)
    for (const name of ['click','change','submit']) addEvent.call(document, name, interaction, true)
    addEvent.call(window, 'popstate', route); addEvent.call(window, 'hashchange', route)
    renew()
    if (!allowed()) return { fetch: false, xhr: false }
    return { fetch: fetchInstalled, xhr: xhrInstalled }
  } catch { stop(); return { fetch: false, xhr: false } }
}

export function stopPageCapture(nonce: string) {
  const controller = (window as unknown as Record<string, unknown>).__asynctest_page_capture_v2__ as { nonce?: string; stop?: () => void } | undefined
  if (controller?.nonce === nonce) controller.stop?.()
}
