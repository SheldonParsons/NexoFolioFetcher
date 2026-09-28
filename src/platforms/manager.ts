import { ApiError, object, isUuid } from '../api/nexofolio/client'
import { listEnvironments, selectedEnvironment, createEnvironment } from '../api/nexofolio/environments'
import { listProjects, requireProject } from '../api/nexofolio/projects'
import type { AuthManager } from '../auth/manager'
import { serviceOriginPattern } from '../auth/contracts'
import { PLATFORM_STORAGE_PREFIX, type BoundProject, type PageTarget, type PlatformContext, type PlatformRule, type PlatformScope } from './contracts'
import { matchingRule, matchesPath, normalizeScope } from './scope'

type Access = { service: { url: string }; userId: string; token: string; assertCurrent: () => void }
export class PlatformManager {
  private writes: Promise<unknown> = Promise.resolve()
  constructor(private auth: AuthManager) {}
  private key(access: Access) { return PLATFORM_STORAGE_PREFIX + encodeURIComponent(access.service.url) + ':' + access.userId }
  private choiceKey(access: Access, target: PageTarget, rule: PlatformRule) { return `nexofolio-platform-choice:${this.key(access)}:${target.tabId}:${rule.id}` }
  private async rules(access: Access): Promise<PlatformRule[]> {
    const value = (await chrome.storage.local.get(this.key(access)))[this.key(access)]
    if (!value) return []
    if (!Array.isArray(value)) throw new ApiError('protocol', '无法读取平台绑定。')
    return value.map(item => {
      const row = object(item)
      if (typeof row.id !== 'string' || typeof row.origin !== 'string' || typeof row.prefix !== 'string' || typeof row.authorized !== 'boolean' || !Array.isArray(row.projects)) throw new ApiError('protocol', '平台绑定数据格式不正确。')
      const scope = normalizeScope(row.origin, row.prefix)
      const projects = row.projects.map(item => {
        const project = object(item)
        if (!isUuid(project.id) || typeof project.name !== 'string') throw new ApiError('protocol', '平台项目绑定格式不正确。')
        return { id: project.id, name: project.name, environmentName: typeof project.environmentName === 'string' ? project.environmentName : undefined, environmentId: isUuid(project.environmentId) ? project.environmentId : undefined }
      })
      return { ...scope, id: row.id, name: typeof row.name === 'string' ? row.name : '', authorized: row.authorized, projects }
    })
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
    if (!page) return { page: null, status: 'unsupported', rule: null, selected: null }
    const rule = matchingRule(page.origin, page.pathname, await this.rules(access))
    const allowed = await chrome.permissions.contains({ origins: [serviceOriginPattern(page.origin)] })
    access.assertCurrent()
    if (!allowed || !rule?.authorized) return { page, status: 'unauthorized', rule, selected: null }
    const choiceKey = this.choiceKey(access, page, rule)
    const selectedId = (await chrome.storage.session.get(choiceKey))[choiceKey]
    const selected = rule.projects.length === 1 ? rule.projects[0]! : rule.projects.find(project => project.id === selectedId) ?? null
    return { page, rule, selected, status: !rule.projects.length ? 'unbound' : selected ? (selected.environmentId || selected.environmentName?.trim()) ? 'bound' : 'needs-environment' : 'ambiguous' }
  }
  context(windowId: number) {
    return this.auth.withSession(async access => {
      const context = await this.describe(access, windowId)
      if ((context.status === 'bound' || context.status === 'needs-environment') && context.selected) {
        const project = await requireProject(access.service.url, access.token, context.selected)
        context.selected = { ...context.selected, id: project.id, name: project.name }
        if (context.selected.environmentId) context.selected.environmentName = (await selectedEnvironment(access.service.url, access.token, project.id, context.selected.environmentId)).name
      }
      access.assertCurrent()
      return context
    })
  }
  captureContext(windowId: number) {
    return this.auth.withSession(async access => {
      const context = await this.describe(access, windowId)
      if ((context.status === 'bound' || context.status === 'needs-environment') && context.selected) await requireProject(access.service.url, access.token, context.selected)
      // More-specific platform rules always form a boundary, including unbound rules.
      const scope = context.rule ? {
        origin: context.rule.origin, prefix: context.rule.prefix,
        excludedPrefixes: (await this.rules(access)).filter(rule => rule.origin === context.rule!.origin
          && rule.prefix !== context.rule!.prefix && matchesPath(rule.prefix, context.rule!.prefix)).map(rule => rule.prefix),
      } : null
      access.assertCurrent()
      return { context, scope, destination: { serviceUrl: access.service.url, userId: access.userId }, owner: `${access.service.url}:${access.userId}:${access.sessionId}` }
    })
  }
  projects(search: string, page: number) { return this.auth.withSession(access => listProjects(access.service.url, access.token, page)) }
  private serialize<T>(action: () => Promise<T>) {
    const operation = this.writes.then(action, action)
    this.writes = operation.catch(() => {})
    return operation
  }
  private scopeFor(target: PageTarget, input: PlatformScope) {
    const scope = normalizeScope(input.origin, input.prefix)
    if (scope.origin !== target.origin || !matchesPath(target.pathname, scope.prefix)) throw new ApiError('input', '当前页面不在这个地址范围内。')
    return scope
  }
  private normalizeName(value: string) {
    const name = value.trim()
    if (!name || name.length > 100) throw new ApiError('input', '平台名称需要为 1～100 个字符。')
    return name
  }
  authorize(expected: PageTarget, input: PlatformScope, name?: string) {
    return this.serialize(() => this.auth.withSession(async access => {
      const target = await this.currentTarget(expected)
      const scope = this.scopeFor(target, input)
      if (!await chrome.permissions.contains({ origins: [serviceOriginPattern(scope.origin)] })) throw new ApiError('permission', '尚未获得浏览器访问许可。')
      const rules = await this.rules(access)
      let rule = rules.find(item => item.origin === scope.origin && item.prefix === scope.prefix)
      if (rule) {
        rule.authorized = true
        if (name !== undefined) rule.name = this.normalizeName(name)
      } else { rule = { ...scope, id: crypto.randomUUID(), name: this.normalizeName(name ?? target.title.slice(0, 100)), authorized: true, projects: [] }; rules.push(rule) }
      await this.currentTarget(expected); access.assertCurrent()
      await chrome.storage.local.set({ [this.key(access)]: rules })
      return this.describe(access, target.windowId)
    }))
  }
  bind(expected: PageTarget, input: PlatformScope, project: BoundProject) {
    return this.serialize(() => this.auth.withSession(async access => {
      const target = await this.currentTarget(expected)
      const scope = this.scopeFor(target, input)
      const rules = await this.rules(access)
      const rule = rules.find(item => item.origin === scope.origin && item.prefix === scope.prefix)
      if (!rule?.authorized || !await chrome.permissions.contains({ origins: [serviceOriginPattern(scope.origin)] })) throw new ApiError('permission', '请先授权这个平台范围。')
      const verified = await requireProject(access.service.url, access.token, project)
      await this.currentTarget(expected); access.assertCurrent()
      const inputName = this.normalizeEnvironment(project.environmentName)
      const environment = project.environmentId ? await selectedEnvironment(access.service.url, access.token, project.id, project.environmentId) : await createEnvironment(access.service.url, access.token, project.id, inputName)
      const environmentName = environment.name
      // Deduplicate only within this scope. Other origins/ports/prefixes may bind the same project.
      const existing = rule.projects.find(item => item.id === verified.id)
      if (existing) { existing.environmentName = environmentName; existing.environmentId = environment.id; existing.name = verified.name }
      else rule.projects.push({ id: verified.id, name: verified.name, environmentName, environmentId: environment.id })
      await this.currentTarget(expected); access.assertCurrent()
      await chrome.storage.local.set({ [this.key(access)]: rules })
      await chrome.storage.session.set({ [this.choiceKey(access, target, rule)]: verified.id })
      return this.describe(access, target.windowId)
    }))
  }
  private normalizeEnvironment(value: unknown) {
    if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 64 || /[\u0000-\u001f\u007f]/.test(value)) throw new ApiError('input', '环境名称需为1–64个字符，可使用中文，不含控制字符。')
    return value.trim()
  }
  environments(projectId: string, page: number) {
    return this.auth.withSession(access => listEnvironments(access.service.url, access.token, projectId, page))
  }
  environment(expected: PageTarget, ruleId: string, projectId: string, value: string, environmentId?: string) {
    return this.serialize(() => this.auth.withSession(async access => {
      const target = await this.currentTarget(expected)
      const inputName = this.normalizeEnvironment(value)
      const rules = await this.rules(access)
      const rule = matchingRule(target.origin, target.pathname, rules)
      const project = rule?.projects.find(item => item.id === projectId)
      if (!rule?.authorized || rule.id !== ruleId || !project) throw new ApiError('stale', '绑定已变化，请重新选择。')
      await requireProject(access.service.url, access.token, project)
      const environment = environmentId ? await selectedEnvironment(access.service.url, access.token, projectId, environmentId) : await createEnvironment(access.service.url, access.token, projectId, inputName)
      await this.currentTarget(expected); access.assertCurrent()
      project.environmentName = environment.name
      project.environmentId = environment.id
      await chrome.storage.local.set({ [this.key(access)]: rules })
      return this.describe(access, target.windowId)
    }))
  }
  rename(expected: PageTarget, ruleId: string, value: string) {
    return this.serialize(() => this.auth.withSession(async access => {
      const target = await this.currentTarget(expected)
      const name = this.normalizeName(value)
      const rules = await this.rules(access)
      const rule = matchingRule(target.origin, target.pathname, rules)
      if (!rule || rule.id !== ruleId) throw new ApiError('stale', '当前平台已变化，请重新操作。')
      rule.name = name
      await this.currentTarget(expected); access.assertCurrent()
      await chrome.storage.local.set({ [this.key(access)]: rules })
      return this.describe(access, target.windowId)
    }))
  }
  select(expected: PageTarget, ruleId: string, projectId: string) {
    return this.auth.withSession(async access => {
      const target = await this.currentTarget(expected)
      const rule = matchingRule(target.origin, target.pathname, await this.rules(access))
      const project = rule?.projects.find(item => item.id === projectId)
      if (!rule?.authorized || rule.id !== ruleId || !project) throw new ApiError('stale', '绑定已变化，请重新选择。')
      await requireProject(access.service.url, access.token, project)
      await this.currentTarget(expected); access.assertCurrent()
      await chrome.storage.session.set({ [this.choiceKey(access, target, rule)]: projectId })
      return this.describe(access, target.windowId)
    })
  }
  unbind(expected: PageTarget, ruleId: string, projectId: string) {
    return this.serialize(() => this.auth.withSession(async access => {
      const target = await this.currentTarget(expected)
      const rules = await this.rules(access)
      const rule = matchingRule(target.origin, target.pathname, rules)
      if (!rule || rule.id !== ruleId) throw new ApiError('stale', '绑定已变化，请重试。')
      rule.projects = rule.projects.filter(project => project.id !== projectId)
      access.assertCurrent()
      await chrome.storage.local.set({ [this.key(access)]: rules })
      await chrome.storage.session.remove(this.choiceKey(access, target, rule))
      // Keep the explicit child scope even when empty; don't silently fall back to its parent.
      return this.describe(access, target.windowId)
    }))
  }
}
