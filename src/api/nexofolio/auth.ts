import { ApiError, NexoFolioClient, object, isUuid } from './client'
export interface UserProfile { id: string; username: string; displayName: string; avatarUrl: string }
export type ProjectSync = { status: 'completed' | 'failed' | 'skipped' }
export const AUTH_ENDPOINTS = { login: '/v1/auth/login', profile: '/v1/auth/me' } as const
export function profileFrom(value: unknown): UserProfile {
  const data = object(value)
  if (!isUuid(data.id) || typeof data.account !== 'string' || !data.account || typeof data.display_name !== 'string' || data.enabled !== true) throw new ApiError('protocol', '无法读取当前用户资料。')
  // This API has no avatar field. Use the existing initials fallback, never invent an avatar endpoint.
  return { id: data.id, username: data.account, displayName: data.display_name || data.account, avatarUrl: '' }
}
export async function login(serviceUrl: string, account: string, password: string) {
  const data = object(await new NexoFolioClient(serviceUrl).request(AUTH_ENDPOINTS.login, { method: 'POST', body: { account, password }, timeoutMs: 65000 }))
  const sync = object(data.project_sync)
  if (typeof data.token !== 'string' || !data.token.startsWith('nfi_') || /\s/.test(data.token) || data.token_type !== 'Bearer'
      || typeof data.expires_at !== 'string' || !Number.isFinite(Date.parse(data.expires_at)) || typeof data.token_reused !== 'boolean'
      || !['completed', 'failed', 'skipped'].includes(String(sync.status))) throw new ApiError('protocol', '登录响应不符合 NexoFolio 协议。')
  return { token: data.token, user: profileFrom(data.user), expiresAt: data.expires_at, tokenReused: data.token_reused, projectSync: { status: sync.status as ProjectSync['status'] } }
}
export async function currentUser(serviceUrl: string, token: string): Promise<UserProfile> {
  return profileFrom(object(await new NexoFolioClient(serviceUrl, token).request(AUTH_ENDPOINTS.profile)).user)
}
