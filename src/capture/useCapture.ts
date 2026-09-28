import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { APP_PROTOCOL } from '../auth/contracts'
import { CAPTURE_PORT, type CaptureSnapshot, type CaptureDetail } from './contracts'

export function useCapture() {
  const snapshot = shallowRef<CaptureSnapshot>({ status: 'idle', message: '', rows: [] })
  const detail = shallowRef<CaptureDetail | null>(null)
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let port: chrome.runtime.Port | null = null
  let windowId: number | undefined
  let disposed = false
  let connecting = false
  let generation = 0

  function releasePort() {
    clearInterval(heartbeat); heartbeat = undefined
    detail.value = null
    const previous = port
    port = null
    try { previous?.disconnect() } catch { /* The extension context may already be invalidated. */ }
  }
  function disconnect() {
    ++generation
    connecting = false
    releasePort()
    snapshot.value = { ...snapshot.value, status: 'idle', message: '监听已停止。' }
  }
  function interrupted(message: string) {
    ++generation
    connecting = false
    releasePort()
    if (!disposed) snapshot.value = { ...snapshot.value, status: 'interrupted', message }
  }
  function post(message: object) {
    if (!port) return
    try { port.postMessage(message) }
    catch { interrupted('监听通道已失效，请重试；若刚刷新扩展，请关闭旧 panel 后重新打开。') }
  }
  async function connect() {
    if (disposed || windowId === undefined) { disconnect(); return }
    if (port || connecting) return
    const request = ++generation
    connecting = true
    snapshot.value = { ...snapshot.value, status: 'checking', message: '正在连接捕获模块…' }
    try {
      // Wake the worker and confirm this build has a ready receiver before creating a long-lived port.
      const reply = await chrome.runtime.sendMessage({ type: 'capture.ready', protocol: APP_PROTOCOL })
      if (disposed || request !== generation) return
      if (!reply?.ok || !reply.data?.ready || reply.data.protocol !== CAPTURE_PORT) {
        snapshot.value = { ...snapshot.value, status: 'error', message: reply?.data?.message || reply?.error?.message || '后台尚未加载捕获模块，请刷新扩展并重新打开 panel。' }
        return
      }
      const connected = chrome.runtime.connect({ name: CAPTURE_PORT })
      port = connected
      connected.onMessage.addListener((value: CaptureSnapshot | CaptureDetail) => {
        if (port !== connected || disposed) return
        if ('kind' in value && value.kind === 'detail') detail.value = value
        else snapshot.value = value as CaptureSnapshot
      })
      connected.onDisconnect.addListener(() => {
        // Read before the stale-port guard: even a discarded connection can carry lastError.
        const reason = chrome.runtime.lastError?.message
        if (port !== connected) return
        port = null
        clearInterval(heartbeat); heartbeat = undefined
        detail.value = null
        if (disposed) return
        snapshot.value = { ...snapshot.value, status: 'interrupted', message: reason?.includes('Receiving end does not exist')
          ? '捕获后台连接未建立，请刷新扩展并重新打开 panel。'
          : '监听连接已断开，请重试或重新打开 panel。' }
      })
      post({ type: 'watch', windowId, visible: document.visibilityState === 'visible' })
      heartbeat = setInterval(() => { if (document.visibilityState === 'visible') post({ type: 'heartbeat' }) }, 5000)
    } catch {
      if (!disposed && request === generation) interrupted('无法连接捕获后台，请刷新扩展并关闭旧 panel 后重新打开。')
    } finally { if (request === generation) connecting = false }
  }
  function visibility() {
    if (port) post({ type: 'visibility', visible: document.visibilityState === 'visible' })
    else if (document.visibilityState === 'visible') void connect()
  }
  async function retry() {
    await connect()
    post({ type: 'retry' })
  }
  onMounted(async () => {
    document.addEventListener('visibilitychange', visibility)
    try {
      windowId = (await chrome.windows.getCurrent()).id
      if (!disposed) await connect()
    } catch { snapshot.value = { ...snapshot.value, status: 'error', message: '无法读取当前窗口。' } }
  })
  onBeforeUnmount(() => { disposed = true; document.removeEventListener('visibilitychange', visibility); disconnect() })
  function requestDetail(id: number | null) { detail.value = null; post({ type: 'detail', id }) }
  return { snapshot, detail, requestDetail, retry }
}
