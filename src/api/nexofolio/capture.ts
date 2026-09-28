import { ApiError, NexoFolioClient } from './client'
import { validateAssetReceipt, validateCaptureCapabilities } from '../../contracts/ingestion/validators.js'
import type { CaptureCapabilities, AssetReceipt } from '../../contracts/capture/types.generated'
import type { QueueAsset } from '../../upload/contracts'
export async function captureCapabilities(base:string, token:string):Promise<CaptureCapabilities> {
  const result=await new NexoFolioClient(base,token).request('/v1/ingestion/capabilities?schema_version=3')
  if(!validateCaptureCapabilities(result) || !(result as CaptureCapabilities).schema_versions.includes('3')) throw new ApiError('server','服务尚未支持持续录制v3，数据保留待重试。',503)
  return result as CaptureCapabilities
}
export async function uploadAsset(base:string,token:string,asset:QueueAsset) {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),30000)
  try {
    const response=await fetch(`${base.replace(/\/+$/,'')}/v1/projects/${asset.destination.projectId}/assets/${asset.id}`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':asset.mediaType},body:new Blob([asset.bytes.buffer as ArrayBuffer],{type:asset.mediaType}),credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal})
    if(!response.ok){
      const retry=response.headers.get('Retry-After'),seconds=retry===null?NaN:Number(retry)
      const delay=retry===null?undefined:Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(retry)-Date.now())
      throw new ApiError(response.status===401?'auth':response.status===403?'permission':'server','图像资产尚未确认，原始数据保留。',response.status,undefined,Number.isFinite(delay)?delay:undefined)
    }
    const receipt=await response.json() as AssetReceipt
    if(!validateAssetReceipt(receipt)||receipt.asset_id!==asset.id||receipt.project_id!==asset.destination.projectId||receipt.bytes!==asset.bytes.byteLength||receipt.sha256!==asset.sha256||receipt.media_type!==asset.mediaType)throw new ApiError('protocol','图像资产回执不一致。')
    return receipt
  } catch(error){if(error instanceof ApiError)throw error;throw new ApiError('network','图像资产上传未确认。')}
  finally {clearTimeout(timer)}
}
