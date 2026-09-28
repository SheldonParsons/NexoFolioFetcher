import { object, isUuid } from '../api/nexofolio/client'
import { AUTH_STORAGE_PREFIX, serviceOriginPattern } from '../auth/contracts'
import { SERVICE_STORAGE_KEY } from '../settings/service'
import { SITE_CACHE_PREFIX } from '../platforms/contracts'
import type { PlatformManager } from '../platforms/manager'
import { CAPTURE_LIMIT, BODY_LIMIT, BODY_TIMEOUT, PAGE_RELAY_PORT, type CapturedRequest, type CapturedInput, type CapturedResponse, type CaptureScope, type CaptureSnapshot, type CaptureDetail, type PageCaptureOptions } from './contracts'
import { installPageCapture, stopPageCapture } from './pageHook'
import { installPageRelay, stopPageRelay } from './pageRelay'
import { parseInput, parseBody, parseHeaders } from './requestData'
import { UploadManager } from '../upload/manager'
import type { Destination, Observation } from '../upload/contracts'
import { CaptureIdentity } from '../evidence/identity'
import { installPageSampler } from '../evidence/pageSampler'
import { validObservedTime, type EvidenceContext, type ContextSeed } from '../evidence/context'
import { matchesPath } from '../platforms/scope'

type Peer = { port: chrome.runtime.Port; windowId?: number; visible: boolean; detailId?: number }
type Frame = { eventSequences: Map<string,number>; title?: string; seed: ContextSeed; reservations: string[]; id: number; documentId: string; nonce: string; url: string; port?: chrome.runtime.Port; installed: boolean }
type RunningCapture = { destination: Destination; scope: CaptureScope; key: string; tabId: number; windowId: number; url: string; documentId: string; accepting: boolean; frames: Map<number, Frame>; refreshing: boolean }
type RecordEntry = { context?: EvidenceContext; queueId: string; destination: Destination; sourcePage: string; savingTerminal?: boolean; request: CapturedInput; row: CapturedRequest; response: CapturedResponse; frame: Frame; requestId: string }
const emptyResponse = (): CapturedResponse => ({ state: 'pending', status: null, statusText: '', contentType: '', url: '', encoding: 'none', bytes: 0, message: '', body: '', headers: { entries: [], state: 'unreadable', message: '等待响应头。' } })

// One rolling buffer across page changes; only adding the 21st record evicts the oldest.
// Body data stays in memory. The page bridge has no access to credentials or API commands.
export class CaptureManager {
  private peers = new Set<Peer>()
  private active: RunningCapture | null = null
  private identity = new CaptureIdentity()
  private retired = new Set<RunningCapture>()
  private retireTimers = new Map<RunningCapture, ReturnType<typeof setTimeout>>()
  private entries: RecordEntry[] = []
  private inflight = new Map<string, RecordEntry>()
  private focusTimer: ReturnType<typeof setTimeout> | undefined
  private sequence = 0
  private generation = 0
  private processing = false
  private pending = false
  private watchedTab: number | undefined
  private navigating = new Set<number>()
  private reportWindow: number | undefined
  private displayOwner: string | undefined
  private status: CaptureSnapshot['status'] = 'idle'
  private message = ''
  private publishTimer: ReturnType<typeof setTimeout> | undefined
  private checkTimer: ReturnType<typeof setInterval> | undefined

  constructor(private platforms: PlatformManager, private uploads: UploadManager) {
    uploads.onChange(() => { this.replenish(); this.publish() })
    chrome.tabs.onActivated.addListener(info => {
      if (this.active && info.windowId !== this.active.windowId) return
      if (info.tabId !== this.watchedTab) {
        this.watchedTab = info.tabId
        this.reconcileSoon(true)
      }
    })
    chrome.tabs.onUpdated.addListener((tabId, changes) => {
      if (changes.status === 'complete') this.navigating.delete(tabId)
      if (tabId !== this.watchedTab) return
      // Tab loading notifications can come from subframes. Only top-level navigation
      // or an actual address change invalidates this page's capture.
      if (changes.url !== undefined && this.active && changes.url !== this.active.url) {
        this.routeChanged(changes.url)
      } else if (changes.url !== undefined || changes.status === 'complete') {
        this.reconcileSoon()
      }
    })
    chrome.tabs.onRemoved.addListener(tabId => {
      this.navigating.delete(tabId)
      if (tabId === this.watchedTab) { this.watchedTab = undefined; this.reconcileSoon(true) }
    })
    chrome.windows.onFocusChanged.addListener(windowId => {
      clearTimeout(this.focusTimer)
      if (windowId === this.active?.windowId) return
      this.detach()
      // Chrome can briefly report WINDOW_ID_NONE while focus moves between its surfaces.
      // Stop immediately, but resolve the actual focused window before choosing the next capture target.
      this.focusTimer = setTimeout(() => this.reconcileSoon(), 150)
    })
    chrome.webNavigation.onBeforeNavigate.addListener(event => {
      if (event.frameId === 0 && event.tabId === this.watchedTab) {
        this.navigating.add(event.tabId)
        this.reconcileSoon(true)
      }
    })
    chrome.webNavigation.onCommitted.addListener(event => {
      if (event.frameId === 0) {
        this.navigating.delete(event.tabId)
        if (event.tabId !== this.watchedTab) return
        const run = this.active
        const sameDocument = run?.documentId === event.documentId
        this.reconcileSoon(!!run && (!sameDocument || !this.inScope(event.url, run.scope)))
      } else if (this.active?.tabId === event.tabId) this.refreshSoon(this.active)
    })
    const routeChanged = (event: { tabId: number; frameId: number; url: string }) => {
      if (event.frameId === 0 && event.tabId === this.watchedTab) {
        // replaceState/pushState may update history state without changing the URL.
        // Those notifications must not discard requests from the current page.
        if (this.active?.url === event.url) return
        this.routeChanged(event.url)
      } else if (event.frameId !== 0 && this.active?.tabId === event.tabId) this.refreshSoon(this.active)
    }
    chrome.webNavigation.onHistoryStateUpdated.addListener(routeChanged)
    chrome.webNavigation.onReferenceFragmentUpdated.addListener(routeChanged)
    chrome.webNavigation.onErrorOccurred.addListener(event => {
      if (event.frameId === 0 && event.tabId === this.watchedTab) {
        this.navigating.delete(event.tabId)
        this.reconcileSoon()
      }
    })
    chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'nexofolio-capture') this.reconcileSoon() })
    void chrome.alarms.create('nexofolio-capture', { periodInMinutes: .5 })
    this.checkTimer = setInterval(() => this.reconcileSoon(), 30000)
    this.reconcileSoon()
    chrome.permissions.onRemoved.addListener(() => { this.detach(); this.reconcileSoon() })
    chrome.storage.onChanged.addListener((changes, area) => {
      const relevant = Object.entries(changes).some(([key, change]) => {
        if (area !== 'local') return false
        if (key === SERVICE_STORAGE_KEY || key.startsWith(SITE_CACHE_PREFIX)) return true
        if (key.startsWith(AUTH_STORAGE_PREFIX)) {
          const before = object(change.oldValue), after = object(change.newValue)
          return before.id !== after.id || before.token !== after.token
        }
        return false
      })
      if (relevant) {
        if (area === 'local' && Object.keys(changes).some(key => key === SERVICE_STORAGE_KEY || key.startsWith(AUTH_STORAGE_PREFIX))) this.displayOwner = undefined
        this.detach()
        this.reconcileSoon()
      }
    })
  }

  connect(port: chrome.runtime.Port) {
    const peer: Peer = { port, visible: false }
    this.peers.add(peer)
    port.onMessage.addListener(input => {
      const message = object(input)
      if (message.type === 'watch' && Number.isInteger(message.windowId) && Number(message.windowId) >= 0) {
        peer.windowId = Number(message.windowId); peer.visible = message.visible === true
        this.reconcileSoon()
      } else if (message.type === 'visibility' && peer.visible !== (message.visible === true)) {
        peer.visible = message.visible === true
        this.publish()
      } else if (message.type === 'retry') { this.detach(); this.reconcileSoon() }
      else if (message.type === 'detail') {
        peer.detailId = Number.isSafeInteger(message.id) ? Number(message.id) : undefined
        this.sendDetail(peer)
      }
      // Heartbeats keep the MV3 worker alive; revalidation has its own 30-second cadence.
    })
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError
      this.peers.delete(peer)
      this.publish()
    })
    this.publish()
  }

  connectRelay(port: chrome.runtime.Port) {
    const sender = port.sender, run = this.active
    const frame = run?.frames.get(sender?.frameId ?? -1)
    if (!run?.accepting || !frame || sender?.id !== chrome.runtime.id || sender.tab?.id !== run.tabId || sender.documentId !== frame.documentId) { port.disconnect(); return }
    let accepted = false
    const timer = setTimeout(() => { if (!accepted) port.disconnect() }, 5000)
    port.onMessage.addListener(input => {
      const message = object(input)
      if ((this.active !== run && !this.retired.has(run)) || run.frames.get(frame.id) !== frame || message.nonce !== frame.nonce) { port.disconnect(); return }
      if (message.type === 'hello' && !accepted && !frame.port) {
        accepted = true; clearTimeout(timer); frame.port = port
        this.send(port, { type: 'ready' })
      } else if (accepted && message.type === 'event') {
        const data = object(message.data)
        if (data.kind !== 'request' || (this.active === run && run.accepting)) this.receive(frame, data, run)
      } else if (accepted && message.type === 'evidence' && this.active === run && run.accepting) {
        this.receiveEvidence(run, frame, message.sample)
      } else if (accepted && message.type === 'suspended' && this.active === run) { this.reconcileSoon(true) }
      else if (accepted && message.type === 'capacity') { this.message = '上传队列容量不足或处理中，新增采集已暂停。'; this.publish() }
    })
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; clearTimeout(timer)
      if (frame.port !== port) return
      frame.port = undefined; frame.installed = false
      if (this.retired.has(run)) { this.stopFrame(run, frame); this.finishFrame(frame); return }
      if (this.active === run && run.accepting) {
        if (frame.id === 0) {
          run.accepting = false
          for (const child of run.frames.values()) { this.stopFrame(run, child); this.finishFrame(child) }
          this.setStatus('interrupted', '采集通道已中断，已有记录保留，可重试监听。')
        } else {
          this.stopFrame(run, frame)
          this.finishFrame(frame)
          this.setStatus('listening', '正在采集响应；部分 iframe 未连接。')
        }
      }
    })
  }
  private inScope(address: string, scope: CaptureScope) {
    try {
      const url = new URL(address)
      return url.origin === scope.origin && matchesPath(url.pathname, scope.prefix)
        && !scope.excludedPrefixes.some(prefix => matchesPath(url.pathname, prefix))
    } catch { return false }
  }
  private routeChanged(address: string) {
    const run = this.active
    if (run?.accepting && this.inScope(address, run.scope)) {
      run.url = address
      // Revalidate asynchronously while the same document's wrappers keep running.
      this.reconcileSoon()
    } else this.reconcileSoon(!!run)
  }
  private send(port: chrome.runtime.Port, data: object) { try { port.postMessage(data) } catch {} }
  private setStatus(status: CaptureSnapshot['status'], message: string) { this.status = status; this.message = message; this.publish() }
  private sendDetail(peer: Peer) {
    if (peer.detailId === undefined) return
    const entry = this.entries.find(entry => entry.row.id === peer.detailId && this.visibleEntry(entry))
    this.send(peer.port, { kind: 'detail', id: peer.detailId, request: entry?.request || null, response: entry?.response || null } satisfies CaptureDetail)
  }
  private visibleEntry(entry:RecordEntry) { return this.displayOwner === JSON.stringify([entry.destination.serviceUrl, entry.destination.userId]) }
  private publish() {
    clearTimeout(this.publishTimer); this.publishTimer = undefined
    for (const peer of this.peers) {
      const relevant = peer.visible && peer.windowId === this.reportWindow
      this.send(peer.port, { status: relevant ? this.status : 'idle', message: relevant ? this.message : '仅监听当前活动页面。', rows: this.entries.filter(entry => this.visibleEntry(entry)).map(entry => ({ ...entry.row, upload: this.uploads.observationState(entry.queueId) })), upload: this.uploads.status() } satisfies CaptureSnapshot)
    }
  }
  private reconcileSoon(stopImmediately = false) {
    ++this.generation
    if (stopImmediately) {
      this.detach()
      this.setStatus('checking', '正在检查页面授权与绑定…')
    }
    this.pending = true
    if (!this.processing) void this.drain()
  }
  private async drain() {
    this.processing = true
    try {
      while (this.pending) {
        this.pending = false
        const generation = this.generation
        try { await this.reconcile(generation) }
        catch (error) {
          if (generation !== this.generation) continue
          this.detach()
          this.setStatus('error', error instanceof Error ? error.message : '无法开始监听，请重试。')
        }
      }
    } finally { this.processing = false }
  }
  private refreshSoon(run: RunningCapture) {
    void this.refreshFrames(run).catch(() => {
      if (this.active === run) {
        this.detach()
        this.setStatus('error', '无法读取页面框架，已有记录保留，请重试监听。')
      }
    })
  }
  private current(generation: number) { return generation === this.generation }
  private stopFrame(run: RunningCapture, frame: Frame) {
    const port = frame.port
    frame.port = undefined; frame.installed = false
    for (const id of frame.reservations) this.uploads.release(id)
    frame.reservations = []
    if (port) { this.send(port, { type: 'stop' }); try { port.disconnect() } catch {} }
    const target = { tabId: run.tabId, documentIds: [frame.documentId] }
    void chrome.scripting.executeScript({ target, world: 'ISOLATED', func: stopPageRelay, args: [frame.nonce] }).catch(() => {})
    void chrome.scripting.executeScript({ target, world: 'MAIN', func: stopPageCapture, args: [frame.nonce] }).catch(() => {})
  }
  private detach(run = this.active) {
    if (this.active === run) this.active = null
    if (!run || this.retired.has(run)) return
    run.accepting = false
    this.retired.add(run)
    for (const frame of run.frames.values()) {
      for (const id of frame.reservations) this.uploads.release(id)
      frame.reservations = []
      if (frame.port) this.send(frame.port, { type: 'suspend' })
    }
    // Continue only already-started HTTP under its original frozen binding/context.
    const timer = setTimeout(() => {
      for (const frame of run.frames.values()) { this.stopFrame(run, frame); this.finishFrame(frame) }
      this.retired.delete(run); this.retireTimers.delete(run)
    }, 47000)
    this.retireTimers.set(run,timer)
  }
  private async reconcile(generation: number) {
    await this.identity.ready
    if (!this.current(generation)) return
    if (this.active && !this.active.accepting) this.detach()
    const window = await chrome.windows.getLastFocused()
    if (!this.current(generation)) return
    if (!window.focused || window.id === undefined) {
      this.detach(); this.setStatus('stopped', '窗口未激活，监听已暂停，已有记录保留。'); return
    }
    this.reportWindow = window.id
    const [tab] = await chrome.tabs.query({ active: true, windowId: window.id })
    if (!this.current(generation)) return
    this.watchedTab = tab?.id
    if (tab?.id === undefined || !tab.url || this.navigating.has(tab.id) || (tab.pendingUrl && tab.pendingUrl !== tab.url)) {
      this.detach(); this.setStatus('checking', '等待页面切换完成…'); return
    }
    if (!this.active) this.setStatus('checking', '正在检查页面授权与绑定…')
    const { context, owner, scope, destination } = await this.platforms.captureContext(window.id)
    if (!this.current(generation)) return
    this.displayOwner = JSON.stringify([destination.serviceUrl, destination.userId])
    const binding = context.binding
    if (!scope || context.status !== 'bound' || !context.page || !binding || context.page.tabId !== tab.id) {
      this.detach(); this.setStatus('stopped', '当前页面尚未完成授权和项目绑定。'); return
    }
    const latest = await chrome.tabs.get(tab.id)
    if (!this.current(generation)) return
    if (!latest.active || !latest.url || (latest.pendingUrl && latest.pendingUrl !== latest.url)) { this.reconcileSoon(true); return }
    if (latest.url !== tab.url) { this.routeChanged(latest.url); return }
    const document = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 })
    if (!this.current(generation)) return
    if (!document?.documentId || !this.inScope(document.url, scope)) {
      this.detach(); this.setStatus('checking', '等待主页面加载完成…'); return
    }
    const queueDestination: Destination = { ...destination, projectId: binding.project.id, environment: { id: binding.environment.id }, site: { origin: scope.origin, prefix: scope.prefix } }
    const key = JSON.stringify([owner, tab.id, document.documentId, scope, queueDestination])
    if (this.active?.key === key && this.active.accepting) { this.active.url = tab.url; await this.refreshFrames(this.active); this.publish(); return }
    this.detach()
    const run: RunningCapture = { destination: queueDestination, scope, key, tabId: tab.id, windowId: window.id, url: tab.url, documentId: document.documentId, accepting: true, frames: new Map(), refreshing: false }
    this.active = run
    await this.refreshFrames(run)
    if (this.active !== run) { this.detach(run); return }
    // A queued read-only recheck (for example tabs.onUpdated complete) does not
    // invalidate the installed hooks. The next drain pass reuses this same run.
    if (!this.current(generation)) return
    if (!run.frames.get(0)?.installed) {
      if (this.uploads.status().paused) { this.detach(run); this.setStatus('stopped', '上传队列容量不足，已暂停新增采集，未确认数据保留。'); return }
      throw new Error('页面拦截未能安装，请刷新页面后重试。')
    }
  }
  private async refreshFrames(run: RunningCapture) {
    if (run.refreshing || this.active !== run || !run.accepting) return
    run.refreshing = true
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId: run.tabId })
      if (this.active !== run || !run.accepting) return
      const main = frames?.find(frame => frame.frameId === 0)
      if (main?.documentId !== run.documentId || !this.inScope(main.url, run.scope)) { this.reconcileSoon(true); return }
      let partial = false
      for (const [id, frame] of run.frames) {
        if (!frames?.some(info => info.frameId === id && info.documentId === frame.documentId)) {
          this.stopFrame(run, frame); this.finishFrame(frame); run.frames.delete(id)
        }
      }
      for (const info of [...(frames || [])].sort((a,b) => a.frameId === 0 ? -1 : b.frameId === 0 ? 1 : a.frameId - b.frameId)) {
        if (this.active !== run || !run.accepting) return
        const previous = run.frames.get(info.frameId)
        if (previous?.documentId === info.documentId && (previous.url === info.url || info.frameId === 0 && this.inScope(info.url, run.scope)) && previous.installed) continue
        if (previous) { this.stopFrame(run, previous); this.finishFrame(previous); run.frames.delete(info.frameId) }
        if (!info.documentId || !/^https?:\/\//i.test(info.url)) { partial = true; continue }
        const permitted = await chrome.permissions.contains({ origins: [serviceOriginPattern(info.url)] })
        if (this.active !== run || !run.accepting) return
        if (!permitted || (info.frameId === 0 && !this.inScope(info.url, run.scope))) { partial = true; continue }
        const frame: Frame = { eventSequences: new Map(), seed: await this.identity.seed(run.documentId, info.documentId), reservations: [], id: info.frameId, documentId: info.documentId, nonce: crypto.randomUUID(), url: info.url, installed: false }
        if (this.active !== run || !run.accepting) return
        for (let i = 0; i < 2; i++) { const id = this.uploads.reserve(); if (id) frame.reservations.push(id) }
        if (!frame.reservations.length) { partial = true; continue }
        run.frames.set(frame.id, frame)
        const target = { tabId: run.tabId, documentIds: [frame.documentId] }
        const options: PageCaptureOptions = { contextSeed: frame.seed, credits: frame.reservations.length, scope: frame.id === 0 ? run.scope : undefined, nonce: frame.nonce, url: frame.url, maxBytes: BODY_LIMIT, maxRows: CAPTURE_LIMIT, bodyTimeout: BODY_TIMEOUT, requestTimeout: 30000, leaseMs: 15000, relayPort: PAGE_RELAY_PORT }
        try {
          const relay = await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: installPageRelay, args: [options] })
          if (this.active !== run || !run.accepting) { this.stopFrame(run, frame); return }
          if (!relay[0]?.result || !frame.port) throw new Error('Relay unavailable')
          const injected = await chrome.scripting.executeScript({ target, world: 'MAIN', func: installPageCapture, args: [options] })
          if (this.active !== run || !run.accepting) { this.stopFrame(run, frame); return }
          const result = injected[0]?.result
          frame.installed = !!(result?.fetch || result?.xhr)
          if (!result?.fetch || !result?.xhr) partial = true
          if (!frame.installed) this.stopFrame(run, frame)
          // The sampler only supplies the page title and interaction ids; capture works without it.
          else await chrome.scripting.executeScript({ target, world: 'MAIN', func: installPageSampler, args: [{nonce:frame.nonce}] }).catch(() => [])
        } catch { this.stopFrame(run, frame); partial = true }
      }
      if (this.active === run && run.accepting && run.frames.get(0)?.installed) this.setStatus('listening', partial ? '正在采集响应；部分页面框架未覆盖。' : '正在采集 XHR / fetch 响应')
    } finally { run.refreshing = false }
  }
  private captureContext(frame:Frame,value:unknown,allocate=true):EvidenceContext|undefined {
    const raw=object(value)
    if(!isUuid(raw.view_id)||!Number.isSafeInteger(raw.event_seq)||Number(raw.event_seq)<0||typeof raw.page_url!=='string')return undefined
    if(raw.interaction_id!==undefined&&!isUuid(raw.interaction_id))return undefined
    for(const time of [raw.request_started_at_ms,raw.response_completed_at_ms])if(time!==undefined&&!validObservedTime(time))return undefined
    const context:EvidenceContext={
      ...frame.seed,view_id:raw.view_id,event_seq:raw.event_seq as number,page_url:raw.page_url,
      ...(raw.interaction_id?{interaction_id:raw.interaction_id as string}:{}),
      ...(raw.request_started_at_ms!==undefined?{request_started_at_ms:raw.request_started_at_ms as number}:{}),
      ...(raw.response_completed_at_ms!==undefined?{response_completed_at_ms:raw.response_completed_at_ms as number}:{}),
    }
    if(allocate) {
      context.event_seq=(frame.eventSequences.get(context.view_id)||0)+1
      frame.eventSequences.set(context.view_id,context.event_seq)
      while(frame.eventSequences.size>100)frame.eventSequences.delete(frame.eventSequences.keys().next().value!)
    }
    return context
  }
  // Page samples are no longer uploaded; only the title is kept to label the HTTP records of this frame.
  private receiveEvidence(run:RunningCapture,frame:Frame,value:unknown) {
    if(this.active!==run||!run.accepting)return
    const sample=object(value)
    if(sample.kind!=='page_context'||!this.captureContext(frame,sample.context,false))return
    frame.title=String(object(sample.data).title||'').slice(0,1024)
  }
  private observation(entry: RecordEntry): Observation {
    return { context: entry.context, title: entry.frame.title, request: entry.request, response: entry.response, method: entry.row.method, time: entry.row.time, sourcePage: entry.sourcePage, transport: entry.row.type === 'XHR' ? 'xhr' : 'fetch', frame: entry.row.frame }
  }
  private persist(entry: RecordEntry) {
    const terminal = entry.request.body.state !== 'reading' && !['pending','reading'].includes(entry.response.state)
    if (entry.savingTerminal) return
    if (terminal) entry.savingTerminal = true
    void this.uploads.save(entry.queueId, entry.destination, this.observation(entry)).then(() => {
      if (terminal) this.inflight.delete(entry.queueId)
      this.replenish()
    }).catch(() => {
      // Queue owns an immutable dirty copy for disk retry; retain this record too.
      this.message = '上传队列写入失败，新增采集已暂停。'
      this.publish()
    })
  }
  private replenish() {
    for (const [id, entry] of this.inflight) if (entry.savingTerminal && this.uploads.terminalStored(id)) this.inflight.delete(id)
    const run = this.active
    if (!run?.accepting) return
    for (const frame of run.frames.values()) {
      if (!frame.installed || !frame.port) continue
      let count = 0
      while (frame.reservations.length < 2) { const id = this.uploads.reserve(); if (!id) break; frame.reservations.push(id); count++ }
      if (count) {
        this.send(frame.port, { type: 'credit', count })
        if (this.message.startsWith('上传队列容量不足') || this.message.startsWith('上传队列写入失败')) this.message = '正在采集 XHR / fetch 响应'
      }
    }
  }
  private finishFrame(frame: Frame) {
    for (const entry of this.inflight.values()) {
      if (entry.frame !== frame) continue
      const requestPending = entry.request.body.state === 'reading'
      const responsePending = ['pending', 'reading'].includes(entry.response.state)
      if (!requestPending && !responsePending) continue
      if (requestPending) entry.request.body = { ...entry.request.body, state: 'unreadable', message: '采集已停止，请求正文尚未读完。' }
      if (responsePending) entry.response = { ...entry.response, state: 'unreadable', message: '采集已停止，此条响应正文尚未读完。' }
      const { body, headers: responseHeaders, ...summary } = entry.response
      entry.row.response = summary; entry.row.revision++
      this.persist(entry)
      for (const peer of this.peers) if (peer.detailId === entry.row.id) this.sendDetail(peer)
    }
    this.publish()
  }
  private receive(frame: Frame, message: Record<string, unknown>, run: RunningCapture) {
    if (typeof message.requestId !== 'string' || !/^\d{1,16}$/.test(message.requestId)) return
    if (message.kind === 'request') {
      if (typeof message.url !== 'string' || message.url.length > 16384 || !/^https?:\/\//i.test(message.url)
          || typeof message.method !== 'string' || message.method.length > 32 || !['XHR', 'Fetch'].includes(String(message.type))) return
      if ([...this.inflight.values()].some(entry => entry.frame === frame && entry.requestId === message.requestId)) return
      const request = parseInput(message.request)
      if (!request) return
      const context = this.captureContext(frame, message.context)
      if (!context || !validObservedTime(context.request_started_at_ms)) return
      const response = emptyResponse(), { body, headers, ...summary } = response
      const queueId = frame.reservations.shift()
      if (!queueId || this.active !== run || !run.accepting) return
      const entry: RecordEntry = { context, queueId, destination: structuredClone(run.destination), sourcePage: context.page_url, request, row: { id: ++this.sequence, url: message.url, method: message.method, type: message.type as 'XHR' | 'Fetch', time: context.request_started_at_ms, frame: frame.id === 0 ? 'page' : 'iframe', response: summary, revision: 0 }, response, frame, requestId: message.requestId }
      this.inflight.set(queueId, entry)
      this.entries.unshift(entry)
      this.persist(entry)
      while (this.entries.length > CAPTURE_LIMIT) {
        const old = this.entries.pop()!
        for (const peer of this.peers) if (peer.detailId === old.row.id) this.sendDetail(peer)
      }
    } else if (message.kind === 'request-body') {
      const entry = [...this.inflight.values()].find(entry => entry.frame === frame && entry.requestId === message.requestId)
      const body = parseBody(message.body)
      if (!entry || entry.request.body.state !== 'reading' || !body) return
      entry.request.body = body; entry.row.revision++
      this.persist(entry)
      for (const peer of this.peers) if (peer.detailId === entry.row.id) this.sendDetail(peer)
    } else if (message.kind === 'response') {
      const entry = [...this.inflight.values()].find(entry => entry.frame === frame && entry.requestId === message.requestId)
      if (!entry || !['pending', 'reading'].includes(entry.response.state)) return
      const data = object(message.response)
      const headers = parseHeaders(data.headers)
      if (!headers) return
      if (!['reading', 'complete', 'truncated', 'unreadable', 'failed', 'timeout'].includes(String(data.state))
          || !['text', 'base64', 'none'].includes(String(data.encoding)) || typeof data.body !== 'string' || data.body.length > BODY_LIMIT * 2
          || !Number.isInteger(data.bytes) || Number(data.bytes) < 0 || Number(data.bytes) > BODY_LIMIT
          || !(data.status === null || Number.isInteger(data.status) && Number(data.status) >= 0 && Number(data.status) <= 599)) return
      for (const [key, max] of [['statusText', 128], ['contentType', 256], ['url', 16384], ['message', 512]] as const) {
        if (typeof data[key] !== 'string' || data[key].length > max) return
      }
      const completed = this.captureContext(frame, message.context, false)
      if (entry.context && completed?.response_completed_at_ms) entry.context = { ...entry.context, response_completed_at_ms: completed.response_completed_at_ms }
      entry.response = { headers, state: data.state as CapturedResponse['state'], status: data.status as number | null, statusText: String(data.statusText), contentType: String(data.contentType), url: String(data.url), encoding: data.encoding as CapturedResponse['encoding'], bytes: Number(data.bytes), message: String(data.message), body: data.body }
      const { body, headers: responseHeaders, ...summary } = entry.response
      entry.row.response = summary; entry.row.revision++
      this.persist(entry)
      for (const peer of this.peers) if (peer.detailId === entry.row.id) this.sendDetail(peer)
    }
    if (!this.publishTimer) this.publishTimer = setTimeout(() => this.publish(), 50)
  }
}
