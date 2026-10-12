// Backend-only gate. Defaults closed even before storage/OSS initialization.
let allowed: () => boolean = () => false
let rejected: () => void = () => {}
export class UpdateGateError extends Error {
  readonly kind = 'update'
  readonly code = 'FETCHER_UPDATE_CHECK_REQUIRED'
  constructor() { super('版本校验未通过，采集与上传已暂停；已有内容保留。') }
}
export function installVersionAccess(check: () => boolean, reject: () => void) { allowed = check; rejected = reject }
export function versionAllowed() { return allowed() }
export function requireVersionAccess() { if (!allowed()) throw new UpdateGateError() }
export function rejectRuntimeVersion() { rejected() }
