import type { AuthCommand, AuthReply, AuthState, CredentialsCommand, CredentialsReply } from './contracts'
import { APP_PROTOCOL } from './contracts'
import { ApiError } from '../api/nexofolio/client'

export async function authCommand(command: AuthCommand): Promise<AuthState> {
  let reply: AuthReply
  try { reply = await chrome.runtime.sendMessage({ ...command, protocol: APP_PROTOCOL }) }
  catch { throw new Error('无法连接插件后台，请重新打开 panel。') }
  if (!reply) throw new Error('插件后台未响应，请刷新扩展。')
  if (!reply.ok) throw new ApiError(reply.error.kind as ApiError['kind'], reply.error.message)
  return reply.state
}

export async function credentialsCommand(command: CredentialsCommand) {
  const reply: CredentialsReply = await chrome.runtime.sendMessage({ ...command, protocol: APP_PROTOCOL })
  if (!reply) throw new Error('插件后台未响应，请刷新扩展。')
  if (!reply.ok) throw new Error(reply.error.message)
  return reply.credentials
}
