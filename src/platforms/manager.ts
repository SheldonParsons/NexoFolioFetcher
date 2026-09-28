import { ApiError, isUuid, object } from '../api/nexofolio/client'
import { listEnvironments, selectedEnvironment, createEnvironment } from '../api/nexofolio/environments'
import { listProjects, requireProject } from '../api/nexofolio/projects'
import { bindSite, lookupSite, siteFrom } from '../api/nexofolio/sites'
import type { AuthManager } from '../auth/manager'
import { serviceOriginPattern } from '../auth/contracts'
import { legacyChoices, migrateLegacyBindings, resolveLegacyChoice } from '../migrations/nexofolio'
import { SITE_CACHE_PREFIX, type LegacyProject, type Named, type PageTarget, type PlatformContext, type PlatformScope, type SiteBinding } from './contracts'
import { matchingScope, matchesPath, normalizeScope, sameScope } from './scope'

type Access = { service: { url: string }; userId: string; sessionId: string; token: string; assertCurrent: () => void }
type Environment = { id?: string; name: string }

// The server site registry decides which project and environment a page belongs to.
// Lookups are cached per service so a page keeps its binding while the server is unreachable.
export class PlatformManager {
  private writes: Promise<unknown> = Promise.resolve()
  private migrated = new Set<string>()
  constructor(private auth: AuthManager) {}

  private serialize<T>(action: () => Promise<T>) {
    const operation = this.writes.then(action, action)
    this.writes = operation.catch(() => {})
    return operation
  }
  private cacheKey(serviceUrl: string) { return SITE_CACHE_PREFIX + encodeURIComponent(serviceUrl) }
  private async cached(serviceUrl: string): Promise<SiteBinding[]> {
    const value = (await chrome.storage.local.get(this.cacheKey(serviceUrl)))[this.cacheKey(serviceUrl)]
    if (!Array.isArray(value)) return []
    // A cache: unreadable entries are skipped, never fatal.
    return value.flatMap(item => { try { return [siteFrom({ site: item, project: object(item).project, environment: object(item).environment })] } catch { return [] } })
  }
  // The server's answer replaces every cached scope that contains the page and is at least as specific.
  private remember(serviceUrl: string, page: PageTarget, found: SiteBinding | null) {
    return this.serialize(async () => {
      const before = await this.cached(serviceUrl)
      const after = before.filter(entry => !(entry.origin === page.origin && matchesPath(page.pathname, entry.prefix) && (!found || entry.prefix.length >= found.prefix.length)))
      if (found) after.push(found)
      if (JSON.stringify(after) !== JSON.stringify(before)) await chrome.storage.local.set({ [this.cacheKey(serviceUrl)]: after })
    })
  }
  private async lookup(serviceUrl: string, page: PageTarget): Promise<{ binding: SiteBinding | null; offline: boolean }> {
    try {
      const found = await lookupSite(serviceUrl, page.address)
      const binding = found && found.origin === page.origin && matchesPath(page.pathname, found.prefix) ? found : null
      await this.remember(serviceUrl, page, binding)
      return { binding, offline: false }
    } catch (error) {
      if (!(error instanceof ApiError) || !['network', 'server'].includes(error.kind)) throw error
      return { binding: matchingScope(page.origin, page.pathname, await this.cached(serviceUrl)), offline: true }
    }
  }
  private async target(windowId: number, expected?: PageTarget): Promise<PageTarget | null> {
    const [tab] = await chrome.tabs.query({ active: true, windowId })
    const raw = tab?.url
    if (tab?.pendingUrl && tab.pendingUrl !== raw) return null
    if (!tab?.id || !raw) return null
    let url: URL
    try { url = new URL(raw) } catch { return null }
    if (!['https:', 'http:'].includes(url.protocol)) return null
    const target = { tabId: tab.id, windowId, address: url.origin + url.pathname, origin: url.origin, pathname: url.pathname, title: tab.title || url.hostname, faviconUrl: tab.favIconUrl || '' }
    if (expected && (target.tabId !== expected.tabId || target.address !== expected.address)) throw new ApiError('stale', '当前页面已变化，请在新页面重新操作。')
    return target
  }
  private async currentTarget(expected: PageTarget) {
    const target = await this.target(expected.windowId, expected)
    if (!target) throw new ApiError('input', '当前页面不支持平台绑定。')
    return target
  }
  private async describe(access: Access, windowId: number): Promise<PlatformContext> {
    const page = await this.target(windowId)
    if (!page) return { page: null, status: 'unsupported', binding: null, offline: false, legacy: null }
    const { binding, offline } = await this.lookup(access.service.url, page)
    const allowed = await chrome.permissions.contains({ origins: [serviceOriginPattern(page.origin)] })
    // An old multi-project scope is offered while nothing at least as specific is registered.
    const legacy = matchingScope(page.origin, page.pathname, await legacyChoices(access.service.url, access.userId))
    access.assertCurrent()
    return {
      page, binding, offline,
      legacy: legacy && (!binding || legacy.prefix.length > binding.prefix.length) ? legacy : null,
      status: !allowed ? 'unauthorized' : binding ? 'bound' : 'unbound',
    }
  }
  // Registers exactly this scope. A named environment is created when missing.
  private async register(access: Access, scope: PlatformScope, projectId: string, environment: Environment) {
    const id = environment.id ?? (await createEnvironment(access.service.url, access.token, projectId, environment.name)).id
    access.assertCurrent()
    await bindSite(access.service.url, access.token, scope, projectId, id)
  }
  // F9, once per session: single-project scopes go to the server unless it already has that scope.
  private async migrate(access: Access) {
    if (this.migrated.has(access.sessionId)) return
    const complete = await this.serialize(() => migrateLegacyBindings(access.service.url, access.userId, async choice => {
      const found = await lookupSite(access.service.url, choice.origin + choice.prefix)
      if (found && sameScope(found, choice)) return true
      if (choice.projects.length > 1) return false
      const [project] = choice.projects as [LegacyProject]
      await this.register(access, choice, project.id, { id: project.environmentId, name: project.environmentName ?? '' })
      return true
    }))
    if (complete) this.migrated.add(access.sessionId)
  }
  context(windowId: number) {
    return this.auth.withSession(async access => {
      await this.migrate(access).catch(() => {})
      return this.describe(access, windowId)
    })
  }
  captureContext(windowId: number) {
    return this.auth.withSession(async access => {
      const context = await this.describe(access, windowId)
      const binding = context.binding
      // More specific registered scopes form a boundary: their pages belong to another binding.
      const scope = binding ? {
        origin: binding.origin, prefix: binding.prefix,
        excludedPrefixes: (await this.cached(access.service.url)).filter(entry => entry.origin === binding.origin
          && entry.prefix !== binding.prefix && matchesPath(entry.prefix, binding.prefix)).map(entry => entry.prefix),
      } : null
      access.assertCurrent()
      return { context, scope, destination: { serviceUrl: access.service.url, userId: access.userId }, owner: `${access.service.url}:${access.userId}:${access.sessionId}` }
    })
  }
  projects(search: string, page: number) { return this.auth.withSession(access => listProjects(access.service.url, access.token, page)) }
  environments(projectId: string, page: number) {
    return this.auth.withSession(access => listEnvironments(access.service.url, access.token, projectId, page))
  }
  private normalizeEnvironment(value: unknown) {
    if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 64 || /[\u0000-\u001f\u007f]/.test(value)) throw new ApiError('input', '环境名称需为1–64个字符，可使用中文，不含控制字符。')
    return value.trim()
  }
  bind(expected: PageTarget, input: PlatformScope, project: Named, environment: Environment) {
    return this.auth.withSession(async access => {
      const target = await this.currentTarget(expected)
      const scope = normalizeScope(input.origin, input.prefix)
      if (scope.origin !== target.origin || !matchesPath(target.pathname, scope.prefix)) throw new ApiError('input', '当前页面不在这个地址范围内。')
      if (!await chrome.permissions.contains({ origins: [serviceOriginPattern(scope.origin)] })) throw new ApiError('permission', '请先允许插件访问此站点。')
      await requireProject(access.service.url, access.token, project)
      const chosen = environment.id && isUuid(environment.id) ? await selectedEnvironment(access.service.url, access.token, project.id, environment.id) : { name: this.normalizeEnvironment(environment.name) }
      await this.currentTarget(expected); access.assertCurrent()
      await this.register(access, scope, project.id, chosen)
      await this.serialize(() => resolveLegacyChoice(access.service.url, access.userId, scope))
      return this.describe(access, target.windowId)
    })
  }
}
