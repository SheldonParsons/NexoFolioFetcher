import type { ProjectSync, UserProfile } from '../api/nexofolio/auth'
import type { ServiceConfig } from '../settings/service'
export const APP_PROTOCOL = 'nexofolio-v1'
export const AUTH_STORAGE_PREFIX = 'nexofolio.auth.v1:'
export interface AuthState {
  service: ServiceConfig | null
  status: 'anonymous' | 'authenticated' | 'unverified'
  sessionId: string | null
  user: UserProfile | null
  expiresAt?: string
  projectSync?: ProjectSync
  message?: string
  reason?: 'expired' | 'permission' | 'unavailable'
}
export type AuthCommand =
  | { type: 'auth.state'; force?: boolean }
  | { type: 'auth.login'; serviceUrl: string; account: string; password: string; remember: boolean }
  | { type: 'auth.logout'; serviceUrl: string; sessionId: string }
  | { type: 'service.save'; service: ServiceConfig }
export type AuthReply = { ok: true; state: AuthState } | { ok: false; error: { kind: string; message: string } }
export function serviceOriginPattern(serviceUrl: string): string {
  const url = new URL(serviceUrl)
  return `${url.protocol}//${url.hostname}/*`
}

export interface RememberedCredentials { enabled: boolean; account: string; password: string }
export type CredentialsCommand = { type: 'credentials.get'; serviceUrl: string } | { type: 'credentials.preference'; serviceUrl: string; enabled: boolean }
export type CredentialsReply = { ok: true; credentials: RememberedCredentials } | { ok: false; error: { kind: string; message: string } }
