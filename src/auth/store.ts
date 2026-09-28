import type { ProjectSync, UserProfile } from '../api/nexofolio/auth'
import { isUuid } from '../api/nexofolio/client'
import { AUTH_STORAGE_PREFIX, type RememberedCredentials } from './contracts'
export interface StoredSession { id: string; serviceUrl: string; token: string; user: UserProfile; expiresAt: string; projectSync: ProjectSync }
export const sessionKey = (url: string) => AUTH_STORAGE_PREFIX + encodeURIComponent(url)
export async function readSession(url: string): Promise<StoredSession | null> {
  const value = (await chrome.storage.local.get(sessionKey(url)))[sessionKey(url)] as StoredSession | undefined
  if (!value || value.serviceUrl !== url || !isUuid(value.id) || typeof value.token !== 'string' || !value.token.startsWith('nfi_')
      || !value.user || !isUuid(value.user.id) || typeof value.user.username !== 'string' || typeof value.user.displayName !== 'string'
      || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) || !['completed','failed','skipped'].includes(value.projectSync?.status)) return null
  return value
}
export const writeSession = (session: StoredSession) => chrome.storage.local.set({ [sessionKey(session.serviceUrl)]: session })
export const removeSession = (url: string) => chrome.storage.local.remove(sessionKey(url))

const credentialsKey = (url: string) => 'nexofolio.credentials.v1:' + encodeURIComponent(url)
export async function readCredentials(url: string): Promise<RememberedCredentials> {
  const value = (await chrome.storage.local.get(credentialsKey(url)))[credentialsKey(url)] as RememberedCredentials | undefined
  if (!value || typeof value.enabled !== 'boolean') return { enabled: true, account: '', password: '' }
  return { enabled: value.enabled, account: value.enabled && typeof value.account === 'string' ? value.account : '', password: value.enabled && typeof value.password === 'string' ? value.password : '' }
}
export async function writeCredentialsPreference(url: string, enabled: boolean): Promise<RememberedCredentials> {
  const previous = await readCredentials(url)
  const credentials = enabled ? { ...previous, enabled } : { enabled, account: '', password: '' }
  await chrome.storage.local.set({ [credentialsKey(url)]: credentials })
  return credentials
}
export async function writeSuccessfulLogin(session: StoredSession, account: string, password: string, remember: boolean) {
  await chrome.storage.local.set({
    [sessionKey(session.serviceUrl)]: session,
    [credentialsKey(session.serviceUrl)]: { enabled: remember, account: remember ? account : '', password: remember ? password : '' },
  })
}
