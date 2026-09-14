import { ApiError, AsyncTestClient, object } from './client'

export interface UserProfile {
  id: number
  username: string
  displayName: string
  avatarUrl: string
}

export const AUTH_ENDPOINTS = {
  login: '/anonymous/login/',
  check: '/token/check',
  profile: '/user/me/',
} as const

function dataFrom(payload: unknown): Record<string, unknown> {
  const envelope = object(payload)
  if (Number(envelope.result) !== 1) throw new ApiError('protocol', 'NexoFolio 未返回成功结果。')
  return object(envelope.data)
}

export function profileFrom(value: unknown, serviceUrl: string): UserProfile {
  const data = object(value)
  if (!Number.isSafeInteger(data.id) || Number(data.id) <= 0 || typeof data.username !== 'string' || !data.username.trim()) {
    throw new ApiError('protocol', '无法读取当前用户资料。')
  }
  let avatarUrl = ''
  if (typeof data.avatar_url === 'string' && data.avatar_url.trim()) {
    try {
      const url = new URL(data.avatar_url, `${serviceUrl}/`)
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) avatarUrl = url.href
    } catch { /* 没有可用头像时，界面显示昵称首字。 */ }
  }
  return { id: Number(data.id), username: data.username, displayName: typeof data.nick_name === 'string' && data.nick_name.trim() ? data.nick_name.trim() : data.username, avatarUrl }
}

export async function login(serviceUrl: string, username: string, password: string) {
  const data = dataFrom(await new AsyncTestClient(serviceUrl).request(AUTH_ENDPOINTS.login, { method: 'POST', body: { username, password } }))
  if (typeof data.token !== 'string' || !data.token || /[\r\n]/.test(data.token)) throw new ApiError('protocol', '登录响应缺少有效凭证。')
  return { token: data.token, user: profileFrom(data, serviceUrl) }
}

export async function checkToken(serviceUrl: string, token: string): Promise<boolean> {
  const payload = object(await new AsyncTestClient(serviceUrl, token).request(AUTH_ENDPOINTS.check, { timeoutMs: 8000 }))
  if (payload.result === 1 || payload.result === '1') return true
  if (payload.result === 0 || payload.result === '0') return false
  throw new ApiError('protocol', '无法确认登录状态，请稍后重试。')
}

export async function currentUser(serviceUrl: string, token: string): Promise<UserProfile> {
  return profileFrom(dataFrom(await new AsyncTestClient(serviceUrl, token).request(AUTH_ENDPOINTS.profile)), serviceUrl)
}
