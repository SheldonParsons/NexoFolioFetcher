import { ApiError, object, isUuid } from '../api/nexofolio/client'
import type { PageTarget, PlatformScope } from './contracts'
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
  const value = object(message.target)
  if (!Number.isInteger(value.tabId) || !Number.isInteger(value.windowId) || typeof value.address !== 'string') throw new ApiError('input', '当前页面信息不完整。')
  const target = value as unknown as PageTarget
  if (message.type === 'platform.environment') {
    if (!isUuid(message.projectId) || typeof message.ruleId !== 'string' || typeof message.environmentName !== 'string') throw new ApiError('input', '环境信息不完整。')
    return manager.environment(target, message.ruleId, message.projectId, message.environmentName, isUuid(message.environmentId) ? message.environmentId : undefined)
  }
  if (message.type === 'platform.rename') {
    if (typeof message.ruleId !== 'string' || typeof message.name !== 'string') throw new ApiError('input', '平台名称信息不完整。')
    return manager.rename(target, message.ruleId, message.name)
  }
  if (message.type === 'platform.select' || message.type === 'platform.unbind') {
    if (typeof message.ruleId !== 'string' || !isUuid(message.projectId)) throw new ApiError('input', '绑定信息不完整。')
    return message.type === 'platform.select' ? manager.select(target, message.ruleId, message.projectId as string) : manager.unbind(target, message.ruleId, message.projectId as string)
  }
  const scope = object(message.scope)
  if (typeof scope.origin !== 'string' || typeof scope.prefix !== 'string') throw new ApiError('input', '授权范围不完整。')
  const input = scope as unknown as PlatformScope
  if (message.type === 'platform.authorize') {
    if (message.name !== undefined && typeof message.name !== 'string') throw new ApiError('input', '平台名称格式不正确。')
    return manager.authorize(target, input, message.name as string | undefined)
  }
  if (message.type === 'platform.bind') {
    const project = object(message.project)
    if (!isUuid(project.id) || typeof project.name !== 'string') throw new ApiError('input', '请先选择一个可访问项目。')
    return manager.bind(target, input, { id: project.id as string, name: project.name, environmentName: typeof project.environmentName === 'string' ? project.environmentName : undefined, environmentId: isUuid(project.environmentId) ? project.environmentId : undefined })
  }
  throw new ApiError('input', '未知的平台操作。')
}
