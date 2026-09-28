import type { AuthManager } from '../auth/manager'
import { ApiError } from '../api/nexofolio/client'
import { captureCapabilities, uploadAsset } from '../api/nexofolio/capture'
import { capabilities, uploadBatch } from '../api/nexofolio/ingestion'
import { validateBatch, validateBatchV1, validateCaptureBatch, validateCaptureRecord } from '../contracts/ingestion/validators.js'
import { QueueStore } from './store'
import { batchOf, checkedReceipt, convert, interrupted, recordFailure, terminal } from './converter'
import { itemGroupKey, encodedSize, MAX_BATCH_BYTES, MAX_QUEUE_BYTES, MAX_QUEUE_ITEMS, RESERVATION_BYTES, type Destination, type Observation, type QueueBatch, type QueueItem, type QueueStatus, type ObservationUploadState, type QueueAsset, type QueueRecord } from './contracts'

export class UploadManager {
  private store=new QueueStore()
  private items=new Map<string,QueueItem>()
  private assets=new Map<string,QueueAsset>()
  private dirtyAssets=new Map<string,QueueAsset>()
  private batches=new Map<string,QueueBatch>()
  private reservations=new Map<string,number>()
  private serial:Promise<unknown>=Promise.resolve()
  private producer=''
  private sending = new Set<string>()
  private confirmed = new Set<string>()
  private running=false
  private transportEnabled=false
  producerId(){return this.producer}
  enableTransport(){this.transportEnabled=true;this.wake()}
  private message='等待上传服务就绪。'
  private storageFailed=false
  private listeners=new Set<()=>void>()
  private dirty=new Map<string,QueueItem>()
  private timer?:ReturnType<typeof setTimeout>
  readonly ready:Promise<void>
  constructor(private auth:AuthManager, private resolvedEnvironment?: (destination:Destination,environment:{id:string;name:string})=>Promise<void>){
    chrome.storage.onChanged.addListener(()=>this.wake())
    chrome.alarms?.onAlarm.addListener(alarm=>{if(alarm.name==='nexofolio-upload')this.wake()})
    void chrome.alarms?.create('nexofolio-upload',{periodInMinutes:0.5})
    this.ready=this.restore();void this.ready.catch(()=>{this.storageFailed=true;this.message='上传队列无法读取，已暂停新增采集。';this.notify()})}
  observationState(id:string):ObservationUploadState {
    const item=this.items.get(id)
    if(this.confirmed.has(id))return {state:'confirmed',message:'接收服务已确认'}
    if(item?.state==='failed')return {state:'failed',message:item.failure || '上传失败，原始记录保留'}
    if(this.sending.has(id))return {state:'sending',message:'正在上传，等待接收确认'}
    if(item && item.state!=='draft')return {state:'queued',message:'待上传；未确认数据保留'}
    return {state:'collecting',message:'正在采集请求与响应'}
  }
  private hasCredits(){return [...this.reservations.keys()].some(id=>!this.items.has(id))}
  onChange(fn:()=>void){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
  private notify(){for(const fn of this.listeners)fn()}
  private bytes(){return [...this.items.values()].reduce((sum,item)=>sum+item.size,0)+[...this.assets.values()].reduce((sum,asset)=>sum+asset.size,0)}
  status():QueueStatus {
    const reasons=new Map<string,number>();for(const item of this.items.values())if(item.state==='failed'){const reason=item.failure||'UNKNOWN';reasons.set(reason,(reasons.get(reason)||0)+1)}
    return {failures:[...reasons].map(([reason,count])=>({reason,count})),pending:[...this.items.values()].filter(i=>i.state!=='failed').length,failed:[...this.items.values()].filter(i=>i.state==='failed').length,bytes:this.bytes(),paused:this.storageFailed||(!this.canReserve()&&!this.hasCredits()),message:this.message}
  }
  private reservedBytes(){return [...this.reservations.values()].reduce((sum,bytes)=>sum+bytes,0)}
  private canReserve(){return this.items.size+this.reservations.size<MAX_QUEUE_ITEMS && this.bytes()+this.reservedBytes()+RESERVATION_BYTES<=MAX_QUEUE_BYTES}
  terminalStored(id:string){return !this.dirty.has(id) && this.items.get(id)?.state!=='draft'}
  reserve():string|null {
    if(!this.producer||this.storageFailed||!this.canReserve())return null
    const id=crypto.randomUUID();this.reservations.set(id,RESERVATION_BYTES);return id
  }
  release(id:string){this.reservations.delete(id)}
  private exclusive<T>(fn:()=>Promise<T>):Promise<T>{const work=this.serial.then(fn,fn);this.serial=work.catch(()=>{});return work}
  private async restore(){
    const saved=await this.store.all();this.producer=saved.instanceId||crypto.randomUUID()
    if(!saved.instanceId)await this.store.write({instanceId:this.producer})
    for(const asset of saved.assets||[])this.assets.set(asset.id,asset)
    for(const item of saved.items){
      if(item.state==='draft') {item.observation=interrupted(item.observation!);this.finalize(item)}
      this.items.set(item.id,item)
    }
    for(const batch of saved.batches)this.batches.set(batch.id,batch)
    if(saved.items.some(i=>i.state!=='batched'))await this.store.write({items:[...this.items.values()]})
    this.notify();this.wake()
  }
  private finalize(item:QueueItem){
    if(!terminal(item.observation!))return
    item.record=convert(item.observation!)
    item.failure=recordFailure(item.record,item.destination,this.producer,item.wireVersion || '1')||undefined
    item.state=item.failure?'failed':'ready';item.size=encodedSize(item)
  }
  async save(id:string,destination:Destination,value:Observation):Promise<void>{
    // Snapshot before entering the async write queue: callers may mutate their UI object.
    const observation=structuredClone(value), scope=structuredClone(destination)
    return this.exclusive(async()=>{
      await this.ready
      const previous=this.items.get(id)
      if(previous && previous.state!=='draft')return // immutable terminal record
      if(!previous&&!this.reservations.has(id))throw new Error('QUEUE_RESERVATION_REQUIRED')
      const item:QueueItem={wireVersion:previous?.wireVersion || (previous ? '1' : '3'),id,destination:scope,observation,createdAt:previous?.createdAt||Date.now(),size:0,state:'draft'}
      if(terminal(observation))this.finalize(item)
      item.size=encodedSize(item)
      this.items.set(id,item);this.reservations.delete(id)
      // A draft still owns a worst-case reservation while bodies are being collected.
      if(item.state==='draft')this.reservations.set(id,RESERVATION_BYTES)
      this.dirty.set(id,item)
      try {await this.store.write({items:[item]});this.dirty.delete(id)}
      catch {this.storageFailed=true;this.message='队列写入失败，已暂停新增采集；未确认数据保留，等待重试。';this.notify();throw new Error('QUEUE_STORAGE_UNAVAILABLE')}
      this.notify();this.wake()
    })
  }
  async saveEvidence(destination:Destination,record:QueueRecord,asset?:QueueAsset,existingAssetId?:string):Promise<string> {
    const required=encodedSize(record)+(asset?.size||0)+4096
    if(!this.producer||this.storageFailed||this.items.size+this.reservations.size>=MAX_QUEUE_ITEMS||this.bytes()+this.reservedBytes()+required>MAX_QUEUE_BYTES)throw new Error('QUEUE_CAPACITY')
    const id=crypto.randomUUID();this.reservations.set(id,required)
    return this.exclusive(async()=>{
      await this.ready
      const value=structuredClone(record),scope=structuredClone(destination)
      const failure=(existingAssetId&&this.assets.get(existingAssetId)?.state==='failed'?'ASSET_REJECTED':recordFailure(value,scope,this.producer,'3'))||undefined
      const item:QueueItem={id,destination:scope,createdAt:Date.now(),size:0,state:failure?'failed':'ready',record:value,wireVersion:'3',failure,...(asset||existingAssetId?{assetId:asset?.id||existingAssetId}:{})}
      item.size=encodedSize(item)
      this.items.set(id,item);this.reservations.delete(id);this.dirty.set(id,item)
      if(asset){this.assets.set(asset.id,asset);this.dirtyAssets.set(asset.id,asset)}
      try{await this.store.write({items:[item],assets:asset?[asset]:[]});this.dirty.delete(id);if(asset)this.dirtyAssets.delete(asset.id)}
      catch{this.storageFailed=true;this.message='证据队列写入失败，新增采集已暂停。';this.notify();throw new Error('QUEUE_STORAGE_UNAVAILABLE')}
      this.notify();this.wake();return id
    })
  }
  async referenceEvidence(destination:Destination,record:QueueRecord,assetId:string) {
    return this.saveEvidence(destination,record,undefined,assetId)
  }
  private assetReady(item:QueueItem){return !item.assetId || !this.assets.has(item.assetId) || this.assets.get(item.assetId)!.state==='uploaded'}
  wake(){
    const ready=[...this.items.values()].filter(item=>item.state==='ready')
    const urgent=ready.length>=20||ready.reduce((sum,item)=>sum+encodedSize(item.record),0)>=4*1024*1024
    if(urgent&&this.timer){clearTimeout(this.timer);this.timer=undefined}
    if(!this.timer)this.timer=setTimeout(()=>{this.timer=undefined;void this.flush()},urgent?0:1000)
  }
  private async flush(){
    if(this.running)return
    this.running=true
    try {
      await this.ready
      if(this.dirty.size||this.dirtyAssets.size){await this.exclusive(async()=>{await this.store.write({items:[...this.dirty.values()],assets:[...this.dirtyAssets.values()]});this.dirty.clear();this.dirtyAssets.clear();this.storageFailed=false})}
      // Explicit initialization gate plus per-service capabilities verification.
      if (!this.transportEnabled) { this.message='上传服务初始化中，队列保留。'; return }
      const state=await this.auth.snapshot()
      if(state.status!=='authenticated'||!state.service||!state.user){this.message='登录未验证，队列已暂停。';return}
      const owner=(d:Destination)=>d.serviceUrl===state.service!.url&&d.userId===state.user!.id
      const asset=[...this.assets.values()].find(a=>owner(a.destination)&&a.state==='pending'&&a.nextAttempt<=Date.now())
      if(asset){
        try {
          await this.auth.withSession(async access=>{
            if(!owner(asset.destination)||access.service.url!==asset.destination.serviceUrl||access.userId!==asset.destination.userId)throw new ApiError('stale','账号或服务已切换。')
            const capability=await captureCapabilities(access.service.url,access.token);access.assertCurrent()
            if(asset.size>capability.assets.max_bytes||!capability.assets.media_types.includes(asset.mediaType))throw new ApiError('server','图像超出服务支持范围。',413)
            return uploadAsset(access.service.url,access.token,asset)
          })
          const updated={...asset,state:'uploaded' as const};await this.store.write({assets:[updated]});this.assets.set(asset.id,updated)
        } catch(error){
          const permanent=error instanceof ApiError&&[400,404,409,413,415].includes(error.status||0)
          const updated={...asset,state:permanent?'failed' as const:'pending' as const,attempts:asset.attempts+1,nextAttempt:Date.now()+Math.max(error instanceof ApiError?error.retryAfterMs||0:0,Math.min(60000,1000*2**Math.min(asset.attempts+1,6))),failure:permanent?'ASSET_REJECTED':undefined}
          const dependents=permanent?[...this.items.values()].filter(i=>i.assetId===asset.id).map(i=>({...i,state:'failed' as const,failure:'ASSET_REJECTED'})):[]
          await this.store.write({assets:[updated],items:dependents});this.assets.set(asset.id,updated);for(const item of dependents)this.items.set(item.id,item)
          this.message='图像资产未确认，依赖记录保留。'
        }
      }
      let batch=[...this.batches.values()].find(b=>owner(b.destination)&&b.nextAttempt<=Date.now())
      if(!batch)batch=await this.exclusive(async()=>{
        const first=[...this.items.values()].find(i=>i.state==='ready'&&owner(i.destination)&&this.assetReady(i))
        if(!first)return undefined
        const selected:QueueItem[]=[]
        for(const item of this.items.values()){
          if(item.state!=='ready'||!this.assetReady(item)||itemGroupKey(item)!==itemGroupKey(first))continue
          const candidate=batchOf(first.destination,this.producer,[...selected.map(i=>i.record!),item.record!],undefined,first.wireVersion || '1')
          if(selected.length&&(selected.length>=20||encodedSize(candidate)>4*1024*1024))break
          selected.push(item)
        }
        const wire=batchOf(first.destination,this.producer,selected.map(i=>i.record!),undefined,first.wireVersion || '1')
        const created:QueueBatch={id:wire.batch_id,destination:first.destination,itemIds:selected.map(i=>i.id),wire,attempts:0,nextAttempt:0}
        const updates=selected.map(i=>({...i,state:'batched' as const}))
        await this.store.write({items:updates,batches:[created]})
        for(const item of updates)this.items.set(item.id,item)
        this.batches.set(created.id,created);return created
      })
      if(!batch){this.message=this.items.size?'其他账号、服务或失败记录已暂停保留。':'已全部交给接收服务。';return}
      const active=batch
      try {
        const reply=await this.auth.withSession(async access=>{
          if(access.service.url!==active.destination.serviceUrl||access.userId!==active.destination.userId)throw new ApiError('stale','队列所属账号或服务已变化。')
          const supported=active.wire.schema_version==='3' ? await captureCapabilities(access.service.url,access.token) : await capabilities(access.service.url,access.token)
          access.assertCurrent()
          if(!supported.schema_versions.includes(active.wire.schema_version)||!active.wire.records.every(record=>Array.isArray(supported.payload_versions[record.kind as keyof typeof supported.payload_versions])&&(supported.payload_versions[record.kind as keyof typeof supported.payload_versions] as string[]).includes(record.payload_version))||!supported.content_encodings.includes('identity'))throw new ApiError('protocol','上传服务契约不匹配。')
          if(active.wire.records.length>supported.limits.max_records||encodedSize(active.wire)>Math.min(MAX_BATCH_BYTES,supported.limits.max_batch_bytes))throw new ApiError('server','上传批次超过服务上限。',413)
          if(active.wire.records.some(record=>encodedSize(record)>supported.limits.max_record_bytes))throw new ApiError('server','上传记录超过服务上限。',413)
          if (!(active.wire.schema_version === '3' ? validateCaptureBatch : active.wire.schema_version === '1' ? validateBatchV1 : validateBatch)(active.wire)) throw new ApiError('protocol','持久批次不符合固定契约。',400)
          for(const id of active.itemIds)this.sending.add(id)
          this.notify()
          if(active.wire.schema_version==='3'&&!active.wire.records.every(validateCaptureRecord))throw new ApiError('protocol','v3证据不符合契约。',400)
          return uploadBatch(access.service.url,access.token,active.wire)
        })
        const receipt=checkedReceipt(reply,active.wire)
        await this.exclusive(async()=>{
          const deletes:string[]=[],updates:QueueItem[]=[]
          for(const result of receipt.results){
            const id=active.itemIds[result.record_index]!,item=this.items.get(id)!
            if(result.status==='accepted'||result.status==='ignored')deletes.push(id)
            else updates.push({...item,state:result.retryable?'ready':'failed',failure:result.reason_code})
          }
          const deleteAssets=[...this.assets.values()].filter(a=>a.state==='uploaded'&&![...this.items.values()].some(i=>i.assetId===a.id&&!deletes.includes(i.id))).map(a=>a.id)
          await this.store.write({deleteItems:deletes,items:updates,deleteBatches:[active.id],deleteAssets})
          for(const id of deleteAssets)this.assets.delete(id)
          for(const id of deletes){this.items.delete(id);this.confirmed.add(id)}
          while(this.confirmed.size>500){const oldest=this.confirmed.values().next().value;if(oldest)this.confirmed.delete(oldest)}
          for(const item of updates)this.items.set(item.id,item)
          this.batches.delete(active.id)
        })
        this.notify()
        if (receipt.environment) { try { await this.resolvedEnvironment?.(active.destination, receipt.environment) } catch { /* Only a future-binding cache update; queue receipts remain durable. */ } }
        this.message='接收服务已确认；等待后续处理，不代表已生成接口文档。'
      } catch(error){
        if(error instanceof ApiError&&error.status===413){
          await this.exclusive(async()=>{
            if(active.itemIds.length===1){const item={...this.items.get(active.itemIds[0]!)!,state:'failed' as const,failure:'RECORD_TOO_LARGE'};await this.store.write({items:[item],deleteBatches:[active.id]});this.items.set(item.id,item)}
            else {
              const halves=[active.itemIds.slice(0,Math.ceil(active.itemIds.length/2)),active.itemIds.slice(Math.ceil(active.itemIds.length/2))]
              const batches=halves.map(ids=>{const wire=batchOf(active.destination,this.producer,ids.map(id=>this.items.get(id)!.record!),undefined,active.wire.schema_version);return {...active,id:wire.batch_id,itemIds:ids,wire,attempts:0,nextAttempt:0}})
              await this.store.write({deleteBatches:[active.id],batches});for(const next of batches)this.batches.set(next.id,next)
            }
            this.batches.delete(active.id)
          })
          this.message='超限批次已拆分，超限单条保留为失败记录。'
        } else if(error instanceof ApiError && [400,404,415,422].includes(error.status||0)){
          await this.exclusive(async()=>{
            const updates=active.itemIds.map(id=>({...this.items.get(id)!,state:'failed' as const,failure:error.status===404?'PROJECT_OR_ENVIRONMENT_NOT_FOUND':'BATCH_REJECTED'}))
            await this.store.write({items:updates,deleteBatches:[active.id]});for(const item of updates)this.items.set(item.id,item);this.batches.delete(active.id)
          })
          this.message='接收服务拒绝该批次，原始记录保留为失败状态。'
        } else {
          const attempts=active.attempts+1,delay=Math.max(error instanceof ApiError?error.retryAfterMs||0:0,Math.min(60000,1000*2**Math.min(attempts,6)))
          const deferred={...active,attempts,nextAttempt:Date.now()+delay}
          await this.store.write({batches:[deferred]});this.batches.set(deferred.id,deferred)
          this.message=error instanceof ApiError&&error.status===401?'登录失效，队列已暂停。':error instanceof ApiError&&error.status===403?'当前账号无上传权限，队列保留。':'上传未确认，原批次和记录保留，稍后重试。'
        }
      }
    } catch {this.message=this.storageFailed?'队列存储失败，新增采集已暂停。':'上传服务暂未就绪，队列保留。'}
    finally {this.sending.clear();this.running=false;this.notify();if(this.items.size||this.dirty.size){clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=undefined;void this.flush()},1000)}}
  }
}
