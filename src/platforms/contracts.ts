export interface PageTarget { tabId: number; windowId: number; address: string; origin: string; pathname: string; title: string; faviconUrl?: string }
export interface PlatformScope { origin: string; prefix: string }
export interface Named { id: string; name: string }
// One entry of the server site registry: a scope belongs to exactly one project + environment.
export interface SiteBinding extends PlatformScope { project: Named; environment: Named }
// A scope bound to several projects before the registry existed; the user picks one.
export interface LegacyProject { id: string; name: string; environmentId?: string; environmentName?: string }
export interface LegacyChoice extends PlatformScope { projects: LegacyProject[] }
export interface PlatformContext {
  page: PageTarget | null
  status: 'unsupported' | 'unauthorized' | 'unbound' | 'bound'
  binding: SiteBinding | null
  // The server was unreachable; `binding` comes from the local cache.
  offline: boolean
  legacy: LegacyChoice | null
}
// Local cache of registry lookups, per service. The server stays the source of truth.
export const SITE_CACHE_PREFIX = 'nexofolio.sites.v1:'
export type PlatformCommand =
  | { type: 'platform.context'; windowId: number }
  | { type: 'platform.environments'; projectId: string; page: number }
  | { type: 'platform.bind'; target: PageTarget; scope: PlatformScope; project: Named; environment: { id?: string; name: string } }
  | { type: 'platform.projects'; search: string; page: number }
