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
    if (!key.startsWith('nexofolio.platforms.v1:') || !Array.isArray(value)) continue
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
