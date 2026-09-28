import { ApiError, isUuid, object } from '../api/nexofolio/client'
import type { LegacyChoice, PlatformScope } from '../platforms/contracts'
import { normalizeScope, sameScope } from '../platforms/scope'

export const RESET_MARKER = 'nexofolio.migration.backend-v1'
export const RESET_VERSION = 1
let migration: Promise<void> | undefined

// Called before constructing managers or accepting any request. Reload terminates the
// previous worker; old panel messages are rejected by the new APP_PROTOCOL boundary.
export function initializeNexoFolio(): Promise<void> {
  return migration ??= resetOnce().then(removeLegacyBindingService).catch(error => { migration = undefined; throw error })
}
async function resetOnce() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  const marker = (await chrome.storage.local.get(RESET_MARKER))[RESET_MARKER]
  if (marker && typeof marker === 'object' && 'version' in marker && marker.version === RESET_VERSION) return
  const permissions = await chrome.permissions.getAll()
  // Best effort cleanup in already-open documents. Invalidated old bridges also stop
  // on disconnect/pagehide; MAIN's 15-second lease is the fallback if injection fails.
  const tabs = await chrome.tabs.query({})
  function stopLegacyCapture() {
    const host = window as unknown as Record<string, { stop?: () => void } | undefined>
    for (const key of ['__asynctest_page_capture_v2__', '__asynctest_capture_relay_v2__']) {
      try { host[key]?.stop?.() } catch {}
    }
  }
  await Promise.all(tabs.filter(tab => tab.id !== undefined && /^https?:\/\//.test(tab.url || '')).map(async tab => {
    for (const world of ['MAIN', 'ISOLATED'] as const) {
      try { await chrome.scripting.executeScript({ target: { tabId: tab.id!, allFrames: true }, world, func: stopLegacyCapture }) } catch { /* No host access or document gone. */ }
    }
  }))
  const scripts = await chrome.scripting.getRegisteredContentScripts()
  if (scripts.length) await chrome.scripting.unregisterContentScripts({ ids: scripts.map(script => script.id) })
  // These APIs operate only on THIS extension's namespace/origin, never website data.
  await chrome.storage.session.clear()
  await chrome.storage.sync.clear()
  if (typeof caches !== 'undefined') for (const name of await caches.keys()) await caches.delete(name)
  if (typeof indexedDB !== 'undefined' && indexedDB.databases) {
    for (const database of await indexedDB.databases()) if (database.name) {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(database.name!)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(new Error('无法清理插件旧数据库。'))
        request.onblocked = () => reject(new Error('插件旧数据库被占用，请关闭旧 panel 后重新加载扩展。'))
      })
    }
  }
  if (permissions.origins?.length) {
    const removed = await chrome.permissions.remove({ origins: permissions.origins })
    if (!removed) throw new Error('无法撤回插件旧域名权限，请重载扩展后重试。')
  }
  // Marker is written last. No manager is alive yet, and a failed reset never marks success.
  await chrome.storage.local.clear()
  await chrome.storage.local.set({ [RESET_MARKER]: { version: RESET_VERSION, completedAt: new Date().toISOString() } })
}

// Non-destructive model cleanup: never touches queue payloads or resets existing data.
async function removeLegacyBindingService() {
  const marker = 'nexofolio.migration.binding-without-service-v1'
  const values = await chrome.storage.local.get(null)
  if (values[marker] === true) return
  const updates: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(LEGACY_BINDINGS) || !Array.isArray(value)) continue
    let changed = false
    for (const rule of value) {
      if (!rule || !Array.isArray(rule.projects)) continue
      for (const project of rule.projects) {
        if (project && typeof project === 'object' && 'serviceKey' in project) { delete project.serviceKey; changed = true }
      }
    }
    if (changed) updates[key] = value
  }
  await chrome.storage.local.set({ ...updates, [marker]: true })
}

// Bindings kept per service and user before the server site registry existed. They move
// to the server after login; a scope bound to several projects waits for the user's choice.
const LEGACY_BINDINGS = 'nexofolio.platforms.v1:'
const legacyKey = (serviceUrl: string, userId: string) => LEGACY_BINDINGS + encodeURIComponent(serviceUrl) + ':' + userId

// Only projects with an environment can be registered; unreadable or incomplete rules are dropped.
export async function legacyChoices(serviceUrl: string, userId: string): Promise<LegacyChoice[]> {
  const key = legacyKey(serviceUrl, userId)
  const value = (await chrome.storage.local.get(key))[key]
  if (!Array.isArray(value)) return []
  return value.flatMap((item): LegacyChoice[] => {
    const rule = object(item)
    if (typeof rule.origin !== 'string' || typeof rule.prefix !== 'string' || !Array.isArray(rule.projects)) return []
    let scope: PlatformScope
    try { scope = normalizeScope(rule.origin, rule.prefix) } catch { return [] }
    const projects = rule.projects.flatMap(entry => {
      const project = object(entry)
      const environmentId = isUuid(project.environmentId) ? project.environmentId : undefined
      const environmentName = typeof project.environmentName === 'string' && project.environmentName.trim() ? project.environmentName.trim() : undefined
      if (!isUuid(project.id) || typeof project.name !== 'string' || (!environmentId && !environmentName)) return []
      return [{ id: project.id, name: project.name, environmentId, environmentName }]
    })
    return projects.length ? [{ ...scope, projects }] : []
  })
}
async function saveLegacy(serviceUrl: string, userId: string, choices: LegacyChoice[]) {
  const key = legacyKey(serviceUrl, userId)
  if (choices.length) await chrome.storage.local.set({ [key]: choices })
  else await chrome.storage.local.remove(key)
}

// `publish` settles one scope on the server and returns false when the user has to choose.
// Returns whether nothing is left to retry.
export async function migrateLegacyBindings(serviceUrl: string, userId: string, publish: (choice: LegacyChoice) => Promise<boolean>): Promise<boolean> {
  const left: LegacyChoice[] = []
  let complete = true
  for (const choice of await legacyChoices(serviceUrl, userId)) {
    try { if (!await publish(choice)) left.push(choice) }
    catch (error) {
      // Rejected by the server (bad scope, no access, project gone): dropped, the user binds again.
      // Anything else (offline, busy, session change) is kept for the next attempt.
      if (error instanceof ApiError && [400, 403, 404].includes(error.status ?? 0)) continue
      left.push(choice); complete = false
    }
  }
  await saveLegacy(serviceUrl, userId, left)
  return complete
}
export async function resolveLegacyChoice(serviceUrl: string, userId: string, scope: PlatformScope) {
  const choices = await legacyChoices(serviceUrl, userId)
  const left = choices.filter(choice => !sameScope(choice, scope))
  if (left.length !== choices.length) await saveLegacy(serviceUrl, userId, left)
}
