import * as api from '../api/asynctest/auth'
import { ApiError } from '../api/asynctest/client'
import { loadService, saveService, type ServiceConfig } from '../settings/service'
import { type AuthState, serviceOriginPattern } from './contracts'
import { readCredentials, readSession, removeSession, writeCredentialsPreference, writeSession, writeSuccessfulLogin, type StoredSession } from './store'

// 后台唯一会话所有者。页面只收到资料与状态，永远不收到 token。
export class AuthManager {
  private generation = 0
  private writes: Promise<unknown> = Promise.resolve()
  private checks = new Map<string, Promise<AuthState>>()
  private verified = new Map<string, { at: number; state: AuthState }>()
  private credentialEdits = new Map<string, number>()

  async withSession<T>(action: (access: { service: ServiceConfig; userId: number; sessionId: string; token: string; assertCurrent: () => void }) => Promise<T>): Promise<T> {
    const generation = this.generation
    const state = await this.snapshot()
    this.ensureCurrent(generation)
    if (!state.service || !state.user || state.status !== 'authenticated') throw new ApiError('auth', '请先验证 NexoFolio 登录状态。')
    const session = await readSession(state.service.url)
    if (!session || session.id !== state.sessionId) throw new ApiError('stale', '登录状态已变化，请重试。')
    this.ensureCurrent(generation)
    try {
      const result = await action({ service: state.service, userId: state.user.id, sessionId: session.id, token: session.token, assertCurrent: () => this.ensureCurrent(generation) })
      this.ensureCurrent(generation)
      return result
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'auth' && generation === this.generation) await this.expire(state.service, session, generation)
      throw error
    }
  }

  private write<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writes.then(fn, fn)
    this.writes = next.catch(() => {})
    return next
  }

  private ensureCurrent(generation: number) {
    if (generation !== this.generation) throw new ApiError('stale', '登录状态已变化，请重试。')
  }

  private async service(expected?: string): Promise<ServiceConfig> {
    const service = await loadService()
    if (!service) throw new ApiError('input', '请先配置 NexoFolio 服务。')
    if (expected && service.url !== expected) throw new ApiError('stale', '服务地址已变化，请重新操作。')
    return service
  }

  private async allowed(url: string) {
    return chrome.permissions.contains({ origins: [serviceOriginPattern(url)] })
  }

  private state(service: ServiceConfig, session: StoredSession, status: AuthState['status'], message?: string): AuthState {
    return { service, user: session.user, sessionId: session.id, status, message }
  }

  async snapshot(force = false): Promise<AuthState> {
    await this.writes
    const generation = this.generation
    const service = await loadService()
    if (!service) return { service: null, user: null, sessionId: null, status: 'anonymous' }
    const session = await readSession(service.url)
    this.ensureCurrent(generation)
    if (!session) return { service, user: null, sessionId: null, status: 'anonymous' }
    const allowed = await this.allowed(service.url)
    this.ensureCurrent(generation)
    if (!allowed) return { ...this.state(service, session, 'unverified', '需要允许插件访问此服务。'), reason: 'permission' }
    const cached = this.verified.get(session.id)
    if (!force && cached && Date.now() - cached.at < 30000) return { ...cached.state, service }
    const existing = this.checks.get(session.id)
    if (existing) return existing
    const check = this.validate(service, session, generation, force || !cached).finally(() => this.checks.delete(session.id))
    this.checks.set(session.id, check)
    return check
  }

  private async expire(service: ServiceConfig, session: StoredSession, generation: number): Promise<AuthState> {
    await this.write(async () => {
      this.ensureCurrent(generation)
      if ((await readSession(service.url))?.id === session.id) await removeSession(service.url)
    })
    this.verified.delete(session.id)
    return { service, user: null, sessionId: null, status: 'anonymous', reason: 'expired', message: '登录已失效，请重新登录。' }
  }

  private async validate(service: ServiceConfig, session: StoredSession, generation: number, refreshProfile: boolean): Promise<AuthState> {
    try {
      if (!refreshProfile && !await api.checkToken(service.url, session.token)) return await this.expire(service, session, generation)
      this.ensureCurrent(generation)
      // 恢复/手动刷新用 me 一次确认身份和头像；周期检查使用轻量 check。
      const user = refreshProfile ? await api.currentUser(service.url, session.token) : session.user
      this.ensureCurrent(generation)
      if (JSON.stringify(user) !== JSON.stringify(session.user)) {
        await this.write(async () => {
          this.ensureCurrent(generation)
          if ((await readSession(service.url))?.id !== session.id) throw new ApiError('stale', '登录状态已变化。')
          await writeSession({ ...session, user })
        })
      }
      const state = this.state(service, { ...session, user }, 'authenticated')
      this.verified.set(session.id, { at: Date.now(), state })
      return state
    } catch (error) {
      this.ensureCurrent(generation)
      if (error instanceof ApiError && error.kind === 'auth') return this.expire(service, session, generation)
      if (error instanceof ApiError && error.kind === 'stale') throw error
      return { ...this.state(service, session, 'unverified', '暂时无法验证登录状态，登录信息仍已保留。'), reason: 'unavailable' }
    }
  }

  async login(serviceUrl: string, username: string, password: string, remember = false): Promise<AuthState> {
    if (!username.trim() || username.length > 100 || !password || password.length > 1024) throw new ApiError('input', '请输入有效的账号和密码。')
    const generation = ++this.generation
    const service = await this.service(serviceUrl)
    const credentialEdit = this.credentialEdits.get(service.url) ?? 0
    if (!await this.allowed(service.url)) throw new ApiError('permission', '请允许插件访问此服务后再登录。')
    this.ensureCurrent(generation)
    const result = await api.login(service.url, username.trim(), password)
    this.ensureCurrent(generation)
    const session: StoredSession = { id: crypto.randomUUID(), serviceUrl: service.url, token: result.token, user: result.user }
    await this.write(async () => { this.ensureCurrent(generation); await writeSession(session) })
    try {
      const user = await api.currentUser(service.url, session.token)
      this.ensureCurrent(generation)
      session.user = user
      await this.write(async () => { this.ensureCurrent(generation); await writeSession(session) })
    } catch (error) {
      this.ensureCurrent(generation)
      if (error instanceof ApiError && error.kind === 'auth') return this.expire(service, session, generation)
      // 登录已经成功。头像/资料暂时不可用时保留已确认的身份，后续检查会刷新。
    }
    await this.write(async () => {
      this.ensureCurrent(generation)
      const unchanged = credentialEdit === (this.credentialEdits.get(service.url) ?? 0)
      const shouldRemember = remember && (unchanged || (await readCredentials(service.url)).enabled)
      await writeSuccessfulLogin(session, username.trim(), password, shouldRemember)
    })
    const state = this.state(service, session, 'authenticated')
    this.verified.set(session.id, { at: Date.now(), state })
    return state
  }

  async logout(serviceUrl: string, sessionId: string): Promise<AuthState> {
    const generation = ++this.generation
    return this.write(async () => {
      this.ensureCurrent(generation)
      const service = await this.service(serviceUrl)
      const session = await readSession(service.url)
      if (session && session.id !== sessionId) throw new ApiError('stale', '账号已变化，请重新操作。')
      await removeSession(service.url)
      this.verified.delete(sessionId)
      return { service, user: null, sessionId: null, status: 'anonymous' }
    })
  }

  async configure(config: ServiceConfig): Promise<AuthState> {
    const generation = ++this.generation
    await this.write(async () => { this.ensureCurrent(generation); await saveService(config) })
    // 按完整基础地址隔离并保留各服务登录态；换名称不会导致退出。
    return this.snapshot()
  }

  async remembered(serviceUrl: string) {
    await this.service(serviceUrl)
    return readCredentials(serviceUrl)
  }

  async rememberPreference(serviceUrl: string, enabled: boolean) {
    await this.service(serviceUrl)
    this.credentialEdits.set(serviceUrl, (this.credentialEdits.get(serviceUrl) ?? 0) + 1)
    return this.write(async () => { await this.service(serviceUrl); return writeCredentialsPreference(serviceUrl, enabled) })
  }
}
