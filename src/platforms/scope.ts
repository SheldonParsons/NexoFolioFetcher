import { ApiError } from '../api/nexofolio/client'
import type { PlatformScope } from './contracts'

export function normalizeScope(origin: string, prefix: string): PlatformScope {
  const base = new URL(origin)
  if (!['http:', 'https:'].includes(base.protocol) || base.origin !== origin) throw new ApiError('input', '无效的平台地址。')
  const value = prefix.trim() || '/'
  if (!value.startsWith('/') || value.startsWith('//') || /[?#\\]/.test(value)) throw new ApiError('input', '路径前缀以 / 开头，不包含查询参数或 #。')
  return { origin, prefix: new URL(value, origin).pathname.replace(/\/+$/, '') || '/' }
}
// Whole path segments only, like the server: `/app` covers `/app/x` but not `/apple`.
export function matchesPath(pathname: string, prefix: string) { return prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(prefix + '/') }
export const sameScope = (a: PlatformScope, b: PlatformScope) => a.origin === b.origin && a.prefix === b.prefix
// Longest prefix wins, as on the server.
export function matchingScope<T extends PlatformScope>(origin: string, pathname: string, scopes: T[]): T | null {
  return scopes.filter(scope => scope.origin === origin && matchesPath(pathname, scope.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0] ?? null
}
