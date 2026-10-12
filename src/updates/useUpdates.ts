import { onBeforeUnmount, onMounted, ref } from 'vue'
import { UPDATE_STATE_KEY, type UpdateState } from './manager'
export function useUpdates() {
  const state = ref<UpdateState>({ current: chrome.runtime.getManifest().version, allowed: false, phase: 'checking', checking: true, minimumVersion: '0.0.0', message: '正在校验版本…' })
  const error = ref('')
  async function command(type: 'update.state' | 'update.check' | 'update.download') {
    try {
      error.value = ''
      const reply = await chrome.runtime.sendMessage({ type })
      if (!reply?.ok || !reply.data) throw new Error(reply?.error?.message || '暂时无法连接更新服务。')
      state.value = reply.data
    } catch (cause) { error.value = cause instanceof Error ? cause.message : '更新操作失败。' }
  }
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[UPDATE_STATE_KEY]?.newValue) state.value = changes[UPDATE_STATE_KEY].newValue as UpdateState
  }
  const message = (input: unknown, sender: chrome.runtime.MessageSender) => {
    const event = input as { type?: string; data?: UpdateState }
    if (sender.id === chrome.runtime.id && !sender.tab && event?.type === 'update.changed' && event.data) state.value = event.data
  }
  onMounted(() => { chrome.runtime.onMessage.addListener(message); chrome.storage.onChanged.addListener(changed); void command('update.state') })
  onBeforeUnmount(() => { chrome.storage.onChanged.removeListener(changed); chrome.runtime.onMessage.removeListener(message) })
  return { state, error, check: () => command('update.check'), download: () => command('update.download') }
}
