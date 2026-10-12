import { onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue'
import { APP_PROTOCOL, serviceOriginPattern } from '../auth/contracts'
import { REPLAY_PORT, type RecordReference, type ReplayEvent, type ReplayInspection, type ReplayMessage, type ReplayResult, type RequestPayload } from './contracts'

export function useReplay(reference: Ref<RecordReference>, url: Ref<string>) {
  const inspection = shallowRef<ReplayInspection | null>(null), result = shallowRef<ReplayResult | null>(null)
  const inspecting = ref(false), busy = ref(false), granting = ref(false), connected = ref(false), cancelling = ref(false)
  const error = ref(''), phase = ref(''), sentRequest = shallowRef<RequestPayload | null>(null)
  let port: chrome.runtime.Port | undefined, timer: ReturnType<typeof setTimeout> | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined, disposed = false, revision = 0, attemptId = ''
  function post(message: ReplayMessage) {
    if (!port || !connected.value && message.type !== 'hello') return false
    try { port.postMessage(message); return true } catch { lost(); return false }
  }
  function lost() {
    clearInterval(heartbeat); connected.value = false; inspection.value = null; inspecting.value = false
    if (disposed) return
    if (busy.value) error.value = '请求通道已断开，无法确认服务端是否执行。未自动重试。'
    else error.value = '请求通道已断开，请重新连接。'
    busy.value = false; cancelling.value = false; attemptId = ''
  }
  function inspect() {
    clearTimeout(timer); revision++; inspection.value = null
    if (!connected.value || busy.value || disposed || !url.value) { inspecting.value = false; return }
    inspecting.value = true; error.value = ''
    const current = revision
    timer = setTimeout(() => {
      const source = reference.value
      if (!post({ type: 'inspect', revision: current, reference: { id: source.id, recordKey: source.recordKey, target: { ...source.target } }, url: url.value })) inspecting.value = false
    }, 300)
  }
  function connect() {
    if (disposed || port) return
    error.value = ''
    try {
      const connection = chrome.runtime.connect({ name: REPLAY_PORT })
      port = connection
      connection.onMessage.addListener((message: ReplayEvent) => {
        if (disposed || port !== connection) return
        if (message.kind === 'ready') { connected.value = true; inspect() }
        else if (message.kind === 'invalidated') {
          clearTimeout(timer); revision++; inspection.value = null; inspecting.value = false; error.value = message.message
        }
        else if (message.kind === 'inspection' && message.revision === revision) {
          inspecting.value = false; inspection.value = message.inspection ?? null; error.value = message.error ?? ''
        } else if (message.kind === 'sending' && message.attemptId === attemptId) phase.value = '正在等待响应…'
        else if (message.kind === 'result' && message.result.attemptId === attemptId) {
          result.value = message.result; busy.value = false; cancelling.value = false; phase.value = ''; attemptId = ''
          if (message.result.state === 'blocked') inspect()
        }
      })
      connection.onDisconnect.addListener(() => { void chrome.runtime.lastError; if (port === connection) { port = undefined; lost() } })
      post({ type: 'hello', protocol: APP_PROTOCOL, windowId: reference.value.target.windowId })
      heartbeat = setInterval(() => post({ type: 'heartbeat' }), 5000)
    } catch { port = undefined; lost() }
  }
  async function grant() {
    if (!inspection.value || busy.value || granting.value) return
    const origin = inspection.value.origin
    granting.value = true; error.value = ''
    try {
      const allowed = await chrome.permissions.request({ origins: [serviceOriginPattern(origin)] })
      if (disposed) return
      if (!allowed) error.value = '未取得目标域名权限，尚未发送请求。'
      else inspect()
    } catch { if (!disposed) error.value = '无法取得目标域名权限，请重试。' }
    finally { granting.value = false }
  }
  function send(request: RequestPayload, confirmedTarget: boolean) {
    if (busy.value || inspecting.value || !inspection.value || inspection.value.url !== request.url) return false
    attemptId = crypto.randomUUID(); busy.value = true; cancelling.value = false; error.value = ''; phase.value = '正在校验发送条件…'
    result.value = null; sentRequest.value = structuredClone(request)
    if (post({ type: 'send', attemptId, planId: inspection.value.planId, request, confirmedTarget })) return true
    busy.value = false; return false
  }
  function cancel() { if (busy.value && !cancelling.value) { cancelling.value = true; post({ type: 'cancel', attemptId }) } }
  watch([url, () => reference.value.recordKey, () => reference.value.target.address], inspect, { flush: 'sync' })
  const permissionChanged = () => { if (!busy.value) inspect() }
  onMounted(() => { chrome.permissions.onAdded.addListener(permissionChanged); chrome.permissions.onRemoved.addListener(permissionChanged); connect() })
  onBeforeUnmount(() => {
    disposed = true; revision++; clearTimeout(timer); clearInterval(heartbeat)
    chrome.permissions.onAdded.removeListener(permissionChanged); chrome.permissions.onRemoved.removeListener(permissionChanged)
    try { port?.disconnect() } catch {}
    port = undefined
  })
  return { inspection, result, inspecting, busy, granting, connected, cancelling, error, phase, sentRequest, connect, inspect, grant, send, cancel }
}
