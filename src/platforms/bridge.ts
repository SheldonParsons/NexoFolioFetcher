import { APP_PROTOCOL } from '../auth/contracts'
import type { PlatformCommand, PlatformContext } from './contracts'

export async function platformCommand<T = PlatformContext>(command: PlatformCommand): Promise<T> {
  const reply = await chrome.runtime.sendMessage({ ...command, protocol: APP_PROTOCOL })
  if (!reply) throw new Error('插件后台未响应，请刷新扩展。')
  if (!reply.ok) throw new Error(reply.error?.message || '操作失败，请重试。')
  return reply.data as T
}
