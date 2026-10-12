export interface Release {
  schemaVersion: number; product: string; channel: string; installation: string; version: string; builtAt: string; minimumChromeVersion: string
  artifact: { filename: string; url: string; size: number; sha256: string }
  policyVersion?: number; policyRevision?: number; minimumVersion?: string; releaseMode?: 'normal' | 'force'; releaseNotes?: string[]
}
export const RELEASE_ROOT: string
export const LATEST_URL: string
export const CHECK_INTERVAL_MS: number
export function versionParts(value: unknown): number[]
export function compareVersions(a: string, b: string): number
export function parseRelease(input: unknown): Release
