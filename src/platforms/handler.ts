import { ApiError, object, isUuid } from '../api/nexofolio/client'
import type { PageTarget } from './contracts'
import type { PlatformManager } from './manager'

export async function handlePlatformMessage(manager: PlatformManager, message: Record<string, unknown>) {
  if (message.type === 'platform.context') {
    if (!Number.isInteger(message.windowId)) throw new ApiError('input', '缺少当前浏览器窗口。')
    return manager.context(Number(message.windowId))
  }
  if (message.type === 'platform.projects') {
    const page = Number(message.page)
    if (!Number.isInteger(page) || page < 1 || page > 100000 || typeof message.search !== 'string') throw new ApiError('input', '项目查询参数不正确。')
    return manager.projects(message.search, page)
  }
  if (message.type === 'platform.environments') {
    if (!isUuid(message.projectId)) throw new ApiError('input', '项目 ID 不完整。')
    if (!Number.isInteger(message.page) || Number(message.page) < 1 || Number(message.page) > 100000) throw new ApiError('input', '环境页码不正确。')
    return manager.environments(message.projectId, Number(message.page))
  }
  if (message.type === 'platform.bind') {
    const target = object(message.target), scope = object(message.scope), project = object(message.project), environment = object(message.environment)
    if (!Number.isInteger(target.tabId) || !Number.isInteger(target.windowId) || typeof target.address !== 'string') throw new ApiError('input', '当前页面信息不完整。')
    if (typeof scope.origin !== 'string' || typeof scope.prefix !== 'string') throw new ApiError('input', '站点范围不完整。')
    if (!isUuid(project.id) || typeof project.name !== 'string') throw new ApiError('input', '请先选择一个可访问项目。')
    if (typeof environment.name !== 'string' || (environment.id !== undefined && !isUuid(environment.id))) throw new ApiError('input', '环境信息不完整。')
    return manager.bind(target as unknown as PageTarget, { origin: scope.origin, prefix: scope.prefix }, { id: project.id, name: project.name }, { id: environment.id as string | undefined, name: environment.name })
  }
  throw new ApiError('input', '未知的平台操作。')
}
