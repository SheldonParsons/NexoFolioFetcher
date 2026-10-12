import { CHECK_INTERVAL_MS, compareVersions, LATEST_URL, parseRelease, type Release } from './policy.mjs'
import { installVersionAccess } from './access'
export const UPDATE_STATE_KEY = 'nexofolio.update.state.v1'
const POLICY_KEY = 'nexofolio.update.high-water.v1'
export interface UpdateState {
  current: string; allowed: boolean; phase: 'checking' | 'ready' | 'required' | 'unavailable'
  checking: boolean; latest?: Release; minimumVersion: string; checkedAt?: number; message: string
}
export class UpdateManager {
  private current = chrome.runtime.getManifest().version
  private latest?: Release
  private minimum = '0.0.0'
  private revision = 0
  private verifiedUntil = 0
  private checkedAt?: number
  private phase: UpdateState['phase'] = 'checking'
  private message = '正在通过 OSS 校验版本…'
  private flight?: Promise<UpdateState>
  private lastAttempt = 0
  private listeners = new Set<() => void>()
  private expiry?: ReturnType<typeof setTimeout>
  private ready: Promise<void>
  private storageHealthy = true
  constructor() {
    installVersionAccess(() => this.allowed(), () => this.serverRejected())
    chrome.alarms.onAlarm.addListener(alarm => {
      if (alarm.name === 'nexofolio-version-check') void this.check()
    })
    void chrome.alarms.create('nexofolio-version-check', { periodInMinutes: 5 })
    this.ready = this.restore()
    void this.check()
  }
  onChange(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  allowed() { return this.storageHealthy && this.phase === 'ready' && Date.now() < this.verifiedUntil && compareVersions(this.current, this.minimum) >= 0 }
  snapshot(): UpdateState {
    return { current: this.current, allowed: this.allowed(), phase: compareVersions(this.current, this.minimum) < 0 ? 'required' : this.phase,
      checking: !!this.flight, latest: this.latest, minimumVersion: this.minimum, checkedAt: this.checkedAt, message: this.message }
  }
  private emit() {
    for (const listener of this.listeners) listener()
    const state = this.snapshot()
    void chrome.storage.local.set({ [UPDATE_STATE_KEY]: state }).catch(() => {})
    void chrome.runtime.sendMessage({ type: 'update.changed', data: state }).catch(() => {})
  }
  private async restore() {
    try {
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
      const saved = (await chrome.storage.local.get(POLICY_KEY))[POLICY_KEY]
      if (saved !== undefined) {
        const release = parseRelease(saved)
        this.latest = release; this.minimum = release.minimumVersion || '0.0.0'; this.revision = release.policyRevision || 0
      }
    } catch { this.storageHealthy = false; this.message = '本地更新策略无法读取，请重新加载插件；资料仍保留。' }
    this.emit()
  }
  private serverRejected() {
    this.verifiedUntil = 0; this.phase = 'unavailable'; this.message = '服务拒收当前运行版本，正在重新核对 OSS 更新策略。'
    this.emit(); void this.check()
  }
  async check(): Promise<UpdateState> {
    if (this.flight) return this.flight
    // Merge callers and throttle repeated button/transport failures, not an unbounded retry loop.
    if (Date.now() - this.lastAttempt < 10000) return this.snapshot()
    this.lastAttempt = Date.now()
    this.flight = this.perform().finally(() => { this.flight = undefined; this.emit() })
    this.emit()
    return this.flight
  }
  private async perform(): Promise<UpdateState> {
    await this.ready
    if (!this.storageHealthy) return this.snapshot()
    // Keep a still-fresh permit while rechecking; any failure immediately revokes it.
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch(`${LATEST_URL}?check=${Date.now()}`, { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal })
      const date = Date.parse(response.headers.get('Date') || ''), age = Number(response.headers.get('Age') || '0')
      if (response.status !== 200 || !Number.isFinite(date) || Math.abs(Date.now() - date) > 120000 || !Number.isFinite(age) || age > 60 || age < 0) throw new Error('OSS 更新清单未通过新鲜度校验。')
      const reader = response.body?.getReader()
      if (!reader) throw new Error('OSS 更新清单为空。')
      let bytes = 0; const chunks: Uint8Array[] = []
      for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; if (bytes > 65536) { await reader.cancel(); throw new Error('OSS 更新清单超过大小上限。') } chunks.push(next.value) }
      const all = new Uint8Array(bytes); let offset = 0
      for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length }
      const release = parseRelease(JSON.parse(new TextDecoder().decode(all)))
      if (controller.signal.aborted) throw new Error('OSS 校验超时。')
      if ((release.policyRevision || 0) < this.revision || compareVersions(release.minimumVersion || '0.0.0', this.minimum) < 0
        || (this.latest && compareVersions(release.version, this.latest.version) < 0)
        || (this.revision > 0 && release.policyRevision === this.revision && JSON.stringify(release) !== JSON.stringify(this.latest))) throw new Error('更新清单发生回退或同策略内容冲突，保持暂停。')
      // Adopt minimum before storage: a failed persistence must never reopen this worker.
      this.minimum = release.minimumVersion || '0.0.0'; this.revision = release.policyRevision || 0; this.latest = release
      if (compareVersions(this.current, this.minimum) < 0) { this.verifiedUntil = 0; this.phase = 'required'; this.message = '当前版本已停用，请下载并安装更新。'; this.emit() }
      await chrome.storage.local.set({ [POLICY_KEY]: release })
      this.checkedAt = Date.now()
      if (compareVersions(this.current, this.minimum) < 0) {
        this.phase = 'required'; this.verifiedUntil = 0; this.message = '当前版本已停用，请下载并安装更新。'
      } else {
        this.phase = 'ready'; this.verifiedUntil = this.checkedAt + CHECK_INTERVAL_MS
        this.message = '版本校验通过。'
      }
      clearTimeout(this.expiry)
      this.expiry = setTimeout(() => {
        if (!this.allowed() && this.phase === 'ready') { this.phase = 'checking'; this.message = '版本校验已到期，正在重新检查；已有内容保留。' }
        this.emit(); void this.check()
      }, CHECK_INTERVAL_MS)
    } catch {
      this.verifiedUntil = 0; this.phase = 'unavailable'; this.message = '无法确认最新更新策略，采集与上传已暂停。请检查网络后重新检查。'
    } finally { clearTimeout(timer); this.emit() }
    return this.snapshot()
  }
  async download() {
    if (!this.latest) throw new Error('尚无已验证的安装包，请先重新检查。')
    const release = parseRelease(this.latest)
    await chrome.tabs.create({ url: release.artifact.url })
  }
}
