import { ApiError, NexoFolioClient, object, isUuid } from './client'
export interface ProjectCard { id: string; name: string; status: string; canAccess: boolean; accessState: 'allowed' | 'denied' | 'unknown'; reasonCode: string | null }
export interface ProjectPage { count: number; projects: ProjectCard[]; page: number; limit: number }
export function projectFrom(value: unknown): ProjectCard {
  const row = object(value)
  if (!isUuid(row.project_id) || typeof row.name !== 'string' || typeof row.status !== 'string' || typeof row.can_access !== 'boolean'
      || !['allowed','denied','unknown'].includes(String(row.access_state)) || (row.reason_code !== null && typeof row.reason_code !== 'string')
      || row.can_access !== (row.access_state === 'allowed')) throw new ApiError('protocol', '项目列表格式不正确。')
  return { id: row.project_id, name: row.name, status: row.status, canAccess: row.can_access, accessState: row.access_state as ProjectCard['accessState'], reasonCode: row.reason_code as string | null }
}
export async function listProjects(base: string, token: string, page = 1): Promise<ProjectPage> {
  const result = object(await new NexoFolioClient(base, token).request(`/v1/projects?page=${page}&limit=50`))
  if (!Number.isSafeInteger(result.total) || Number(result.total) < 0 || result.page !== page || !Number.isInteger(result.limit) || Number(result.limit) < 1 || Number(result.limit) > 100 || !Array.isArray(result.items)) throw new ApiError('protocol', '项目分页响应不完整。')
  const projects = result.items.map(projectFrom)
  if (projects.length > Number(result.limit) || new Set(projects.map(p => p.id)).size !== projects.length
      || (!projects.length && (page - 1) * Number(result.limit) < Number(result.total))) throw new ApiError('protocol', '项目分页返回异常，请重新读取。')
  return { count: Number(result.total), projects, page, limit: Number(result.limit) }
}
export async function requireProject(base: string, token: string, project: { id: string; name?: string }): Promise<ProjectCard> {
  if (!isUuid(project.id)) throw new ApiError('input', '项目 ID 必须是 NexoFolio UUID。')
  const result = projectFrom(await new NexoFolioClient(base, token).request(`/v1/projects/${project.id}`))
  if (result.id !== project.id) throw new ApiError('protocol', '项目响应 ID 不一致。')
  if (!result.canAccess) throw new ApiError(result.accessState === 'unknown' ? 'server' : 'permission', result.accessState === 'unknown' ? '暂时无法确认项目权限，请稍后重试。' : '你没有权限进入或绑定此项目。', result.accessState === 'unknown' ? 503 : 403, result.reasonCode || undefined)
  return result
}
