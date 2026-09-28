import { ApiError, isUuid, NexoFolioClient, object } from './client'
export interface Environment { id: string; name: string }
export interface EnvironmentPage { items: Environment[]; page: number; limit: number; total: number }
// Same name rule as the backend: 1–64 chars, no control characters, no surrounding space.
const isName=(value:unknown):value is string=>typeof value==='string'&&value.length>=1&&value.length<=64&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value)
const isEnvironment=(value:unknown)=>isUuid(object(value).id)&&isName(object(value).name)
const count=(value:unknown)=>Number.isSafeInteger(value)&&(value as number)>=0
const isEnvironmentPage=(value:unknown)=>{const v=object(value);return Array.isArray(v.items)&&v.items.every(isEnvironment)&&count(v.page)&&count(v.limit)&&(v.limit as number)>0&&count(v.total)}
export async function listEnvironments(base:string,token:string,projectId:string,page=1):Promise<EnvironmentPage> {
  if(!isUuid(projectId))throw new ApiError('input','项目ID必须为UUID。')
  const result=await new NexoFolioClient(base,token).request(`/v1/projects/${projectId}/environments?page=${page}&limit=20`)
  if(!isEnvironmentPage(result))throw new ApiError('protocol','环境列表不符合服务契约。')
  const value=result as EnvironmentPage
  if(value.page!==page||(!value.items.length&&(page-1)*value.limit<value.total))throw new ApiError('protocol','环境分页数据不完整。')
  return value
}

export async function selectedEnvironment(base:string,token:string,projectId:string,id:string) {
  for(let page=1;page<=100000;page++){
    const result=await listEnvironments(base,token,projectId,page)
    const found=result.items.find(item=>item.id===id)
    if(found)return found
    if(page*result.limit>=result.total)break
  }
  throw new ApiError('permission','所选环境不在当前项目中，请重新选择。')
}

export async function createEnvironment(base:string,token:string,projectId:string,name:string):Promise<Environment> {
  if(!isUuid(projectId))throw new ApiError('input','项目ID必须为UUID。')
  const result=await new NexoFolioClient(base,token).request(`/v1/projects/${projectId}/environments`,{method:'POST',body:{name}})
  if(!isEnvironment(result))throw new ApiError('protocol','环境创建响应不符合服务契约。')
  return result as Environment
}
