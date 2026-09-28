import { ApiError, isUuid, NexoFolioClient, object } from './client'
import type { Named, PlatformScope, SiteBinding } from '../../platforms/contracts'

const named = (value: unknown): Named => {
  const row = object(value)
  if (!isUuid(row.id) || typeof row.name !== 'string') throw new ApiError('protocol', '站点登记响应不符合服务契约。')
  return { id: row.id, name: row.name }
}
export function siteFrom(value: unknown): SiteBinding {
  const row = object(value), site = object(row.site)
  if (typeof site.origin !== 'string' || typeof site.prefix !== 'string') throw new ApiError('protocol', '站点登记响应不符合服务契约。')
  return { origin: site.origin, prefix: site.prefix, project: named(row.project), environment: named(row.environment) }
}

// Public: the binding with the longest prefix containing `url`, or null.
export async function lookupSite(base: string, url: string): Promise<SiteBinding | null> {
  const result = await new NexoFolioClient(base).request(`/v1/sites/lookup?url=${encodeURIComponent(url)}`, { timeoutMs: 5000 })
  return result === null ? null : siteFrom(result)
}

// Creates or moves the binding of exactly this scope. Needs a session that can open the project.
export async function bindSite(base: string, token: string, site: PlatformScope, projectId: string, environmentId: string): Promise<void> {
  await new NexoFolioClient(base, token).request('/v1/sites', { method: 'PUT', body: { site: { origin: site.origin, prefix: site.prefix }, project_id: projectId, environment_id: environmentId } })
}
