import type { AuthManager } from '../auth/manager'
import { APP_PROTOCOL, AUTH_STORAGE_PREFIX, serviceOriginPattern } from '../auth/contracts'
import { ApiError, isUuid, object } from '../api/nexofolio/client'
import { requireProject } from '../api/nexofolio/projects'
import { selectedEnvironment } from '../api/nexofolio/environments'
import { lookupSite } from '../api/nexofolio/sites'
import type { CaptureRecord } from '../capture/contracts'
import type { PlatformManager } from '../platforms/manager'
import { SERVICE_STORAGE_KEY } from '../settings/service'
import { requireVersionAccess, versionAllowed } from '../updates/access'
import { executeRequest } from './executor'
import { REPLAY_TIMEOUT, requestUrl, validatePayload, type RecordReference, type ReplayEvent, type ReplayInspection, type ReplayResult } from './contracts'

type Access = { service: { url: string }; userId: string; sessionId: string; token: string; assertCurrent: () => void }
type Plan = { inspection: ReplayInspection; reference: RecordReference; fingerprint: string }
type Pending = { id: string; controller: AbortController; reason: 'cancelled' | 'timeout' | 'blocked'; dispatched: boolean }
type Peer = { port: chrome.runtime.Port; alive: boolean; windowId?: number; revision: number; plan?: Plan; pending?: Pending; checking?: AbortController; used: Set<string> }

export class ReplayManager {
  private peers = new Set<Peer>()
  constructor(private auth: AuthManager, private platforms: PlatformManager,
    private readRecord: (id: number, recordKey: string) => CaptureRecord | null) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && Object.entries(changes).some(([key, change]) => key === SERVICE_STORAGE_KEY
        || key.startsWith(AUTH_STORAGE_PREFIX) && object(change.oldValue).id !== object(change.newValue).id)) this.invalidate()
    })
    chrome.permissions.onRemoved.addListener(() => this.invalidate())
    chrome.tabs.onActivated.addListener(info => {
      for (const peer of this.peers) if (peer.windowId === info.windowId && peer.plan?.reference.target.tabId !== info.tabId) this.invalidatePeer(peer)
    })
    chrome.tabs.onUpdated.addListener((id, change) => {
      if (change.url !== undefined) for (const peer of this.peers) if (peer.plan?.reference.target.tabId === id) this.invalidatePeer(peer)
    })
    chrome.windows.onFocusChanged.addListener(id => {
      for (const peer of this.peers) if (peer.windowId !== id) this.abort(peer, 'blocked')
    })
  }
  versionChanged() { if (!versionAllowed()) this.invalidate() }
  private abort(peer: Peer, reason: Pending['reason']) {
    if (peer.pending && !peer.pending.controller.signal.aborted) { peer.pending.reason = reason; peer.pending.controller.abort() }
  }
  private invalidatePeer(peer: Peer) {
    peer.revision++; peer.plan = undefined; peer.checking?.abort(); this.abort(peer, 'blocked')
    this.post(peer, { kind: 'invalidated', message: '页面、权限或登录状态已变化，请重新核对目标。' })
  }
  private invalidate() { for (const peer of this.peers) this.invalidatePeer(peer) }
  private post(peer: Peer, event: ReplayEvent) { if (peer.alive) { try { peer.port.postMessage(event) } catch {} } }
  connect(port: chrome.runtime.Port) {
    const peer: Peer = { port, alive: true, revision: 0, used: new Set() }
    this.peers.add(peer)
    port.onMessage.addListener(input => {
      const message = object(input)
      if (message.type === 'hello') {
        if (peer.windowId !== undefined || message.protocol !== APP_PROTOCOL || !Number.isInteger(message.windowId) || Number(message.windowId) < 0) { port.disconnect(); return }
        peer.windowId = Number(message.windowId); this.post(peer, { kind: 'ready' }); return
      }
      if (peer.windowId === undefined) { port.disconnect(); return }
      if (message.type === 'inspect' && Number.isSafeInteger(message.revision) && !peer.pending) void this.prepare(peer, message)
      else if (message.type === 'send') void this.send(peer, message)
      else if (message.type === 'cancel' && peer.pending?.id === message.attemptId) this.abort(peer, 'cancelled')
      // Heartbeat keeps the dedicated request channel alive; it never dispatches a request.
    })
    port.onDisconnect.addListener(() => { void chrome.runtime.lastError; peer.alive = false; peer.checking?.abort(); this.abort(peer, 'cancelled'); this.peers.delete(peer) })
  }
  private reference(value: unknown, windowId: number): RecordReference {
    const raw = object(value), target = object(raw.target)
    if (!Number.isSafeInteger(raw.id) || !isUuid(raw.recordKey) || target.windowId !== windowId
      || !Number.isSafeInteger(target.tabId) || typeof target.address !== 'string') throw new Error('记录引用或当前窗口已失效，请返回列表重新打开。')
    return { id: Number(raw.id), recordKey: raw.recordKey, target: target as unknown as RecordReference['target'] }
  }
  private async inspect(access: Access, reference: RecordReference, address: string, signal?: AbortSignal): Promise<Plan> {
    const checkpoint = () => { access.assertCurrent(); requireVersionAccess(); if (signal?.aborted) throw new Error('本次目标核对已取消。') }
    checkpoint()
    const url = requestUrl(address), record = this.readRecord(reference.id, reference.recordKey)
    const source = record?.detail.source, original = record?.detail.request
    if (!source || !original) throw new Error('原始记录已被淘汰或后台已重启，不能用其他同名接口替代。')
    if (source.destination.serviceUrl !== access.service.url || source.destination.userId !== access.userId) throw new Error('账号或服务与原始记录不一致，请返回列表。')
    const { context } = await this.platforms.captureContext(reference.target.windowId)
    checkpoint()
    const page = context.page, binding = context.binding, destination = source.destination
    if (context.status !== 'bound' || context.offline || !page || !binding) throw new Error('当前页面授权、绑定或在线校验未通过，暂不能发送。')
    if (page.tabId !== reference.target.tabId || page.address !== reference.target.address) throw new Error('活动页面已变化，请返回列表重新打开记录。')
    const registered = await lookupSite(access.service.url, page.address)
    checkpoint()
    if (!registered || JSON.stringify(registered) !== JSON.stringify(binding)) throw new Error('当前站点的登记已变化，请返回列表重新读取绑定。')
    if (binding.project.id !== destination.projectId || binding.origin !== destination.site?.origin || binding.prefix !== destination.site?.prefix
      || ('id' in destination.environment ? binding.environment.id !== destination.environment.id : binding.environment.name !== destination.environment.name)) throw new Error('当前站点、项目或环境与原始记录归属不一致，请先回到原绑定范围。')
    await requireProject(access.service.url, access.token, binding.project)
    checkpoint()
    await selectedEnvironment(access.service.url, access.token, binding.project.id, binding.environment.id)
    checkpoint()
    // Site lookup needs only the path, never business query values or URL credentials.
    const targetBinding = await lookupSite(access.service.url, url.origin + url.pathname)
    checkpoint()
    const differentBinding = !!targetBinding && (targetBinding.project.id !== binding.project.id || targetBinding.environment.id !== binding.environment.id)
    if (differentBinding) {
      await requireProject(access.service.url, access.token, targetBinding.project)
      checkpoint()
      await selectedEnvironment(access.service.url, access.token, targetBinding.project.id, targetBinding.environment.id)
      checkpoint()
    }
    const originalOrigin = new URL(original.url).origin
    const [permitted, tab, window] = await Promise.all([
      chrome.permissions.contains({ origins: [serviceOriginPattern(url.origin)] }),
      chrome.tabs.get(page.tabId), chrome.windows.get(page.windowId),
    ])
    checkpoint()
    let currentAddress = ''
    try { const current = new URL(tab.url || ''); currentAddress = current.origin + current.pathname } catch {}
    if (!window.focused || !tab.active || tab.windowId !== page.windowId || currentAddress !== page.address || tab.pendingUrl && tab.pendingUrl !== tab.url) throw new Error('活动页面或窗口已变化，请重新核对后发送。')
    return { reference, fingerprint: JSON.stringify([access.service.url, access.userId, access.sessionId, reference.recordKey,
      page.tabId, page.address, binding, targetBinding]), inspection: {
      planId: crypto.randomUUID(), url: address, origin: url.origin, originalOrigin, needsPermission: !permitted,
      changedTarget: url.origin !== originalOrigin || differentBinding, credentialsAllowed: url.origin === originalOrigin && !differentBinding, binding: targetBinding,
    } }
  }
  private async prepare(peer: Peer, message: Record<string, unknown>) {
    const revision = ++peer.revision
    peer.checking?.abort()
    const checking = new AbortController()
    peer.checking = checking
    peer.plan = undefined
    try {
      const reference = this.reference(message.reference, peer.windowId!)
      if (typeof message.url !== 'string') throw new Error('请求 URL 不完整。')
      const plan = await this.auth.withSession(access => this.inspect(access, reference, message.url as string, checking.signal))
      if (!peer.alive || peer.revision !== revision) return
      peer.plan = plan; this.post(peer, { kind: 'inspection', revision: Number(message.revision), inspection: plan.inspection })
    } catch (cause) {
      if (peer.alive && peer.revision === revision) this.post(peer, { kind: 'inspection', revision: Number(message.revision), error: cause instanceof Error ? cause.message : '无法核对请求目标。' })
    } finally { if (peer.checking === checking) peer.checking = undefined }
  }
  private untilCancelled<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const cancel = () => reject(new Error('已取消等待。'))
      if (signal.aborted) cancel()
      else signal.addEventListener('abort', cancel, { once: true })
      work.then(value => { signal.removeEventListener('abort', cancel); resolve(value) }, cause => { signal.removeEventListener('abort', cancel); reject(cause) })
    })
  }
  private async send(peer: Peer, message: Record<string, unknown>) {
    if (!isUuid(message.attemptId) || peer.used.has(message.attemptId) || peer.pending) return
    const attemptId = message.attemptId, startedAt = Date.now(), plan = peer.plan
    peer.used.add(attemptId)
    while (peer.used.size > 256) peer.used.delete(peer.used.values().next().value!)
    const pending: Pending = { id: attemptId, controller: new AbortController(), reason: 'cancelled', dispatched: false }
    peer.pending = pending
    const timer = setTimeout(() => this.abort(peer, 'timeout'), REPLAY_TIMEOUT)
    const result: ReplayResult = { attemptId, startedAt, elapsedMs: 0, state: 'blocked', message: '', response: null }
    try {
      requireVersionAccess()
      if (!plan || message.planId !== plan.inspection.planId) throw new Error('目标核对已失效，请重新核对后发送。')
      if ([...this.peers].some(other => other !== peer && other.windowId === peer.windowId && other.pending)) throw new Error('此窗口已有请求在发送，请等待或取消。')
      const request = validatePayload(message.request)
      const original = this.readRecord(plan.reference.id, plan.reference.recordKey)
      if (!original) throw new Error('原始记录已被淘汰，未发送请求。')
      if (request.method !== original.row.method) throw new Error('请求方法固定为原始记录的方法，不允许更改。')
      if (request.url !== plan.inspection.url) throw new Error('URL 已变化，请重新核对目标。')
      await this.untilCancelled(this.auth.withSession(async access => {
        const latest = await this.inspect(access, plan.reference, request.url, pending.controller.signal)
        if (latest.fingerprint !== plan.fingerprint) throw new Error('项目、环境或登录状态已变化，请重新核对目标。')
        if (latest.inspection.needsPermission) throw new Error('尚未获得目标站点权限，请点击授权后再发送。')
        if (latest.inspection.changedTarget && message.confirmedTarget !== true) throw new Error('请先核对变更后的目标系统与业务凭据。')
        if (request.credentials === 'include' && !latest.inspection.credentialsAllowed) throw new Error('目标域或环境变化后不可沿用浏览器凭据。')
        // Never forward the extension's own login token, even if a draft was manually altered.
        if (request.headers.some(([, value]) => value.includes(access.token)) || request.url.includes(access.token) || request.body.content.includes(access.token)) throw new Error('此请求包含插件登录凭据，不能作为业务请求发送。')
        access.assertCurrent(); requireVersionAccess()
        if (!peer.alive || pending.controller.signal.aborted || peer.plan !== plan) return
        if (!this.readRecord(plan.reference.id, plan.reference.recordKey)) throw new Error('原始记录已被淘汰，未发送请求。')
        pending.dispatched = true; result.startedAt = Date.now(); this.post(peer, { kind: 'sending', attemptId })
        result.response = await executeRequest(request, pending.controller.signal)
        result.state = 'response'
        result.message = result.response.status ? `HTTP ${result.response.status}；业务结果以响应内容为准。` : result.response.message
      }), pending.controller.signal)
    } catch (cause) {
      result.state = pending.dispatched ? 'network-error' : 'blocked'
      result.message = pending.dispatched ? '网络请求未取得完整响应。可能受到网络、浏览器认证策略或重定向限制；未自动重试。'
        : cause instanceof ApiError || cause instanceof Error ? cause.message : '发送前校验失败。'
      if (cause instanceof ApiError && ['auth', 'stale'].includes(cause.kind)) {
        result.state = 'blocked'; result.response = null; result.message = '登录状态已变化，不再返回本次响应；请求可能已被服务端执行。'
      }
    } finally {
      clearTimeout(timer)
      if (pending.controller.signal.aborted) {
        result.state = pending.reason
        if (pending.reason === 'blocked') result.response = null
        result.message = (pending.reason === 'timeout' ? '等待超过 25 秒。' : pending.reason === 'blocked' ? '页面、登录、授权或版本状态变化，已停止等待。' : '已取消等待。')
          + (pending.dispatched ? '请求可能已被服务端执行，取消不代表回滚。' : '尚未发出业务请求。')
      }
      result.elapsedMs = pending.dispatched ? Date.now() - result.startedAt : 0
      if (peer.pending === pending) peer.pending = undefined
      this.post(peer, { kind: 'result', result })
    }
  }
}
