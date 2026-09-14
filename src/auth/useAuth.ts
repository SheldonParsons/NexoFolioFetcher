import { onBeforeUnmount, ref } from 'vue'
import { ApiError } from '../api/asynctest/client'
import { SERVICE_STORAGE_KEY, type ServiceConfig } from '../settings/service'
import { authCommand } from './bridge'
import { AUTH_STORAGE_PREFIX, serviceOriginPattern, type AuthCommand, type AuthState } from './contracts'

export function useAuth(events: { onLoginSuccess?: (state: AuthState) => void } = {}) {
  const state = ref<AuthState>({ service: null, user: null, status: 'anonymous', sessionId: null })
  const loading = ref(true)
  const busy = ref(false)
  const error = ref('')
  let request = 0
  let disposed = false
  let refreshTimer: ReturnType<typeof setTimeout> | undefined

  async function refresh(force = false) {
    if (busy.value || disposed) return
    const id = ++request
    try {
      const next = await authCommand({ type: 'auth.state', force })
      if (id !== request || disposed) return
      state.value = next
      error.value = ''
    } catch (cause) {
      if (id !== request || disposed) return
      if (cause instanceof ApiError && cause.kind === 'stale') {
        refreshTimer = setTimeout(() => void refresh(), 100)
      } else error.value = cause instanceof Error ? cause.message : '无法读取登录状态。'
    } finally { if (id === request) loading.value = false }
  }

  async function perform(command: AuthCommand) {
    if (busy.value) return false
    busy.value = true
    ++request // 旧的资料检查不能覆盖登录、退出或服务切换的结果。
    error.value = ''
    try {
      const next = await authCommand(command)
      if (disposed) return false
      // Explicit successful login only. Restore/refresh/configure must never replay arrival.
      // Notify before publishing state so the overlay covers the account's first frame.
      if (command.type === 'auth.login' && next.status === 'authenticated' && next.sessionId && next.user) events.onLoginSuccess?.(next)
      state.value = next
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '操作失败，请重试。'
      if (cause instanceof ApiError && cause.kind === 'stale') refreshTimer = setTimeout(() => void refresh(), 100)
      return false
    } finally { busy.value = false; loading.value = false }
  }

  async function login(username: string, password: string, remember: boolean) {
    const service = state.value.service
    if (!service) { error.value = '请先配置 NexoFolio 服务。'; return false }
    if (!username.trim() || !password) { error.value = '请输入账号和密码。'; return false }
    if (busy.value) return false
    // 必须直接从用户点击发起；不能先 await 后再请求 Chrome 权限。
    busy.value = true
    error.value = ''
    try {
      const allowed = await chrome.permissions.request({ origins: [serviceOriginPattern(service.url)] })
      if (!allowed) { error.value = '未获得此服务的访问权限，尚未发送登录信息。'; return false }
    } catch { error.value = '无法获取服务访问权限，请刷新扩展后重试。'; return false }
    finally { busy.value = false }
    if (disposed) return false
    return perform({ type: 'auth.login', serviceUrl: service.url, username, password, remember })
  }

  async function retry() {
    const service = state.value.service
    if (!service || busy.value) return
    error.value = ''
    try {
      const allowed = await chrome.permissions.request({ origins: [serviceOriginPattern(service.url)] })
      if (!allowed) { error.value = '请允许插件访问当前服务。'; return }
      await refresh(true)
    } catch { error.value = '无法连接此服务，请稍后重试。' }
  }

  const logout = () => {
    const { service, sessionId } = state.value
    if (!service || !sessionId) return Promise.resolve(false)
    return perform({ type: 'auth.logout', serviceUrl: service.url, sessionId })
  }
  const configure = (service: ServiceConfig) => perform({ type: 'service.save', service })

  function changed(changes: Record<string, chrome.storage.StorageChange>, area: string) {
    if (area !== 'local' || !Object.keys(changes).some(key => key === SERVICE_STORAGE_KEY || key.startsWith(AUTH_STORAGE_PREFIX))) return
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void refresh(), 100)
  }
  const onVisible = () => { if (document.visibilityState === 'visible') void refresh(true) }
  chrome.storage.onChanged.addListener(changed)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onVisible)
  const interval = setInterval(() => {
    if (document.visibilityState === 'visible' && state.value.sessionId) void refresh()
  }, 60000)
  onBeforeUnmount(() => {
    disposed = true
    ++request
    clearTimeout(refreshTimer)
    clearInterval(interval)
    chrome.storage.onChanged.removeListener(changed)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onVisible)
  })
  return { state, loading, busy, error, refresh, login, logout, configure, retry }
}
