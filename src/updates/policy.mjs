// Shared by the background and release CLI. No secrets and no network side effects.
export const RELEASE_ROOT = 'https://asynctest.oss-cn-shenzhen.aliyuncs.com/nexofolio_fetcher/'
export const LATEST_URL = RELEASE_ROOT + 'latest.json'
export const CHECK_INTERVAL_MS = 300000
export function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(value)) throw new Error('版本格式无效。')
  const parts = value.split('.').map(Number)
  if (parts.some(n => n > 65535)) throw new Error('版本超出 Chrome 支持范围。')
  return [...parts, ...Array(4 - parts.length).fill(0)]
}
export function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b)
  for (let i = 0; i < 4; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  return 0
}
export function parseRelease(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('更新清单无效。')
  const v = input, artifact = v.artifact
  versionParts(v.version)
  if (v.schemaVersion !== 1 || v.product !== 'nexofolio-fetcher' || v.channel !== 'development' || v.installation !== 'load-unpacked'
    || typeof v.minimumChromeVersion !== 'string' || !/^\d+(\.\d+){0,3}$/.test(v.minimumChromeVersion)
    || !Number.isFinite(Date.parse(v.builtAt)) || Date.parse(v.builtAt) > Date.now() + 300000
    || !artifact || artifact.filename !== `NexoFolio-Fetcher-${v.version}-dev.zip`
    || artifact.url !== RELEASE_ROOT + artifact.filename || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > 512 * 1024 * 1024
    || typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error('更新清单内容或下载范围无效。')
  const legacy = v.policyVersion === undefined
  if (legacy && ['minimumVersion','policyRevision','releaseMode','releaseNotes'].some(key => key in v)) throw new Error('更新策略字段不完整。')
  if (!legacy) {
    versionParts(v.minimumVersion)
    if (v.policyVersion !== 1 || !Number.isSafeInteger(v.policyRevision) || v.policyRevision < 1 || !['normal','force'].includes(v.releaseMode)
      || compareVersions(v.minimumVersion, v.version) > 0 || (v.releaseMode === 'force' && compareVersions(v.minimumVersion, v.version) !== 0)
      || !Array.isArray(v.releaseNotes) || v.releaseNotes.length > 32 || v.releaseNotes.some(s => typeof s !== 'string' || s.length > 1000)) throw new Error('更新策略无效。')
  }
  return { schemaVersion: 1, product: v.product, channel: v.channel, installation: v.installation,
    version: v.version, minimumChromeVersion: v.minimumChromeVersion, builtAt: v.builtAt,
    artifact: { filename: artifact.filename, url: artifact.url, size: artifact.size, sha256: artifact.sha256 },
    ...(legacy ? {} : { policyVersion: 1, policyRevision: v.policyRevision, minimumVersion: v.minimumVersion, releaseMode: v.releaseMode, releaseNotes: v.releaseNotes }) }
}
