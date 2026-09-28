import { ApiError } from '../api/nexofolio/client'
import type { PlatformRule, PlatformScope } from './contracts'

export function normalizeScope(origin: string, prefix: string): PlatformScope {
  const base = new URL(origin)
  if (!['http:', 'https:'].includes(base.protocol) || base.origin !== origin) throw new ApiError('input', '无效的平台地址。')
  const value = prefix.trim() || '/'
  if (!value.startsWith('/') || value.startsWith('//') || /[?#\\]/.test(value)) throw new ApiError('input', '路径前缀以 / 开头，不包含查询参数或 #。')
  return { origin, prefix: new URL(value, origin).pathname.replace(/\/+$/, '') || '/' }
}
export function matchesPath(pathname: string, prefix: string) { return prefix === '/' || pathname === prefix || pathname.startsWith(prefix + '/') }
export function matchingRule(origin: string, pathname: string, rules: PlatformRule[]): PlatformRule | null {
  return rules.filter(rule => rule.origin === origin && matchesPath(pathname, rule.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0] ?? null
}
