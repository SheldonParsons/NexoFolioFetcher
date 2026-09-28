// NexoFolio is the only backend. No ZenTao calls or credential forwarding to other origins.
export type ApiErrorKind = 'auth' | 'network' | 'server' | 'protocol' | 'permission' | 'input' | 'stale'
export class ApiError extends Error {
  constructor(public kind: ApiErrorKind, message: string, public status?: number, public code?: string, public retryAfterMs?: number) { super(message) }
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
export const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
export const isAuthFailure = (status: number) => status === 401
export class NexoFolioClient {
  constructor(private baseUrl: string, private token?: string) {}
  async request(path: string, options: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown; timeoutMs?: number } = {}): Promise<unknown> {
    if (!path.startsWith('/v1/') || path.split('?')[0]?.split('/').includes('..')) throw new ApiError('input', '无效的接口路径。')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000)
    try {
      const response = await fetch(this.baseUrl.replace(/\/+$/, '') + path, {
        method: options.method ?? 'GET',
        headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
      })
      let payload: unknown
      try { payload = await response.json() } catch { payload = undefined }
      if (controller.signal.aborted) throw new ApiError('network', '连接超时，请稍后重试。')
      const envelope = object(payload), code = String(object(envelope.error).code ?? envelope.code ?? '')
      if (isAuthFailure(response.status)) throw new ApiError(path === '/v1/auth/login' ? 'input' : 'auth', path === '/v1/auth/login' ? '账号或密码错误，或账号已停用。' : '登录已失效，请重新登录。', 401, code)
      if (!response.ok) {
        const message = response.status === 403 ? '你没有权限进入或绑定此项目。'
          : response.status === 503 && code === 'PROJECT_ACCESS_UNAVAILABLE' ? '暂时无法确认项目权限，请稍后重试。'
          : response.status === 404 ? '未找到服务接口或项目，请检查服务地址及项目。'
          : response.status === 429 ? '服务繁忙，请稍后重试。'
          : response.status === 400 ? '请求参数有误，请检查账号及服务配置。'
          : 'NexoFolio 服务暂时不可用，请稍后重试。'
        const retry = response.headers.get('Retry-After')
        const seconds = retry !== null ? Number(retry) : NaN
        const retryAfterMs = retry === null ? undefined : Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(retry) - Date.now())
        throw new ApiError(response.status === 403 ? 'permission' : 'server', message, response.status, code, Number.isFinite(retryAfterMs) ? retryAfterMs : undefined)
      }
      if (response.status === 204) return null
      if (payload === undefined) throw new ApiError('protocol', '服务返回了无法识别的内容，请检查 NexoFolio 服务地址。', response.status)
      return payload
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError('network', controller.signal.aborted ? '连接超时，请稍后重试。' : '无法连接 NexoFolio，请检查网络与服务地址。')
    } finally { clearTimeout(timer) }
  }
}
