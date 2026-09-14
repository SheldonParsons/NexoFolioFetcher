// AsyncTest 是唯一 API 后端。所有业务请求、鉴权与错误转换收敛在此。
export type ApiErrorKind = 'auth' | 'network' | 'server' | 'protocol' | 'permission' | 'input' | 'stale'

export class ApiError extends Error {
  constructor(public kind: ApiErrorKind, message: string, public status?: number) { super(message) }
}

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function isAuthFailure(status: number, payload: unknown): boolean {
  const data = object(payload)
  return status === 401 || (status === 403 && String(data.code ?? object(data.detail).code ?? '') === '1001')
}

export class AsyncTestClient {
  constructor(private baseUrl: string, private token?: string) {}

  async request(path: string, options: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {}): Promise<unknown> {
    // 路径由 API 模块定义；不要接受页面传来的任意 URL，也不要自动补 /api 或 /server。
    if (!path.startsWith('/') || path.startsWith('//') || path.split('?')[0]?.split('/').includes('..')) throw new ApiError('input', '无效的接口路径。')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000)
    try {
      const response = await fetch(this.baseUrl.replace(/\/+$/, '') + path, {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(this.token ? { Authorization: `token=${this.token}` } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      })
      let payload: unknown
      try { payload = await response.json() }
      catch {
        if (controller.signal.aborted) throw new ApiError('network', '连接超时，请稍后重试。')
        if (response.status === 401) throw new ApiError('auth', '登录已失效，请重新登录。', 401)
        throw new ApiError('protocol', '服务返回了无法识别的内容，请检查后端服务地址。', response.status)
      }
      if (isAuthFailure(response.status, payload)) throw new ApiError('auth', '登录已失效，请重新登录。', response.status)
      if (!response.ok) {
        const message = response.status === 400 ? (path === '/anonymous/login/' ? '账号或密码错误。' : '请求参数有误，请重新操作。')
          : response.status === 429 ? '尝试次数过多，请稍后再试。'
          : response.status === 403 ? '当前账号没有访问权限。'
          : response.status === 404 ? '没有找到接口，请检查后端服务地址及路径前缀。'
          : 'NexoFolio 服务暂时不可用，请稍后重试。'
        throw new ApiError('server', message, response.status)
      }
      return payload
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError('network', controller.signal.aborted ? '连接超时，请稍后重试。' : '无法连接 NexoFolio，请检查网络与服务地址。')
    } finally { clearTimeout(timer) } // Deadline includes body consumption.
  }
}
