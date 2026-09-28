// Temporary development maintenance worker. Never import normal app managers.
// Installed only by prepare-capture-reset.mjs; no website/message-triggered reset API.
const maintenanceStarted = Date.now()
const queueName = 'nexofolio-upload-v1'
const stores = ['items', 'batches', 'assets']
const confirmation = 'CLEAR_CAPTURE_QUEUE_KEEP_SETTINGS'
chrome.runtime.onConnect.addListener(port => port.disconnect())

async function withQueue(operation) {
  if (!(await indexedDB.databases()).some(database => database.name === queueName)) {
    return { items: 0, batches: 0, assets: 0, databaseExists: false }
  }
  const database = await new Promise((resolve, reject) => {
    let blocked = false
    const request = indexedDB.open(queueName)
    request.onupgradeneeded = () => request.transaction.abort()
    request.onerror = () => reject(new Error('无法打开已有队列；未执行清理。'))
    request.onblocked = () => { blocked = true; reject(new Error('数据库被其他上下文阻塞；请关闭旧 panel 后重新加载维护扩展。')) }
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result) }
  })
  try {
    if (!stores.every(name => database.objectStoreNames.contains(name))) {
      throw new Error('队列结构不符，拒绝清理。')
    }
    return await operation(database)
  } finally { database.close() }
}

function counts(database) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(stores, 'readonly')
    const requests = stores.map(name => transaction.objectStore(name).count())
    transaction.oncomplete = () => resolve(Object.fromEntries(stores.map((name, index) => [name, requests[index].result])))
    transaction.onerror = transaction.onabort = () => reject(new Error('无法读取队列数量。'))
  })
}

globalThis.fetcherCaptureMaintenance = Object.freeze({
  mode: 'capture-reset-only',
  extensionId: chrome.runtime.id,
  // Only counts are shown; payloads, account data and credentials never leave storage.
  async preview() { return withQueue(counts) },
  async clear(acknowledgement) {
    if (acknowledgement !== confirmation) throw new Error('仅接受明确确认词 CLEAR_CAPTURE_QUEUE_KEEP_SETTINGS。')
    if (Date.now() - maintenanceStarted < 20000) throw new Error('维护后台启动后请等待至少20秒，让旧页面钩子的15秒租约结束。')
    return withQueue(async database => {
      const before = await counts(database)
      await new Promise((resolve, reject) => {
        // One atomic transaction. Keep meta/producer and all Chrome storage untouched.
        const transaction = database.transaction(stores, 'readwrite', { durability: 'strict' })
        for (const name of stores) transaction.objectStore(name).clear()
        transaction.oncomplete = resolve
        transaction.onerror = transaction.onabort = () => reject(new Error('清理事务失败，未报告成功；请再次预览。'))
      })
      const after = await counts(database)
      if (Object.values(after).some(count => count !== 0)) throw new Error('队列仍有写入，请保持后端暂停并检查是否正确重载到维护后台。')
      return { cleared: before, remaining: after, preserved: ['meta/producer', 'chrome.storage.local', 'chrome.storage.session', 'chrome.storage.sync', 'host permissions'] }
    })
  },
})
console.info('Fetcher capture maintenance loaded. No capture or upload managers running. Preview with await fetcherCaptureMaintenance.preview().')
