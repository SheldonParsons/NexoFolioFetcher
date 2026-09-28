import type { UploadBatch } from '../../upload/contracts'
import { validateCapabilities, validateCapabilitiesV1 } from '../../contracts/ingestion/validators.js'
import { ApiError, NexoFolioClient } from './client'
export async function capabilities(base: string, token: string) {
  let result:unknown
  try {result=await new NexoFolioClient(base,token).request('/v1/ingestion/capabilities')}
  catch(error){if(error instanceof ApiError && error.status===404)throw new ApiError('server','上传服务尚未就绪。',503);throw error}
  if(!validateCapabilities(result) && !validateCapabilitiesV1(result))throw new ApiError('protocol','上传服务契约不匹配。')
  return result as {limits:{max_records:number;max_batch_bytes:number;max_record_bytes:number};schema_versions:string[];payload_versions:{http_exchange:string[]};content_encodings:string[]}
}
export const uploadBatch=(base:string,token:string,batch:UploadBatch)=>new NexoFolioClient(base,token).request('/v1/ingestion/batches',{method:'POST',body:batch,timeoutMs:30000})
