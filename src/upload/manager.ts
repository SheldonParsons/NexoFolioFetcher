import { versionAllowed } from '../updates/access'
import { ApiError } from '../api/nexofolio/client'
import { retryDelay } from '../api/nexofolio/retry'
import type { AuthManager } from '../auth/manager'
import { submitBatch } from '../api/nexofolio/collect'
import { QueueStore } from './store'
import { batchOf, convert, interrupted, recordFailure, rejections, terminal } from './converter'
import { groupKey, encodedSize, BATCH_TARGET_BYTES, MAX_QUEUE_BYTES, MAX_QUEUE_ITEMS, MAX_RECORDS, RESERVATION_BYTES, type Destination, type Observation, type QueueBatch, type QueueItem, type QueueStatus, type ObservationUploadState, rejectionReason } from './contracts'

// Collect needs no token; local identity still fences every frozen destination.
export class UploadManager {
  private store=new QueueStore()
  private items=new Map<string,QueueItem>()
  private batches=new Map<string,QueueBatch>()
  private reservations=new Map<string,number>()
  private serial:Promise<unknown>=Promise.resolve()
  private producer=''
  private sending = new Set<string>()
  private confirmed = new Set<string>()
  private running=false
  private transportEnabled=false
  versionChanged(){
    if (!versionAllowed()) { clearTimeout(this.timer); this.timer=undefined; this.message="版本校验未通过，上传暂停，原队列保留。"; this.notify() }
    else this.wake()
  }
  enableTransport(){this.transportEnabled=true;this.wake()}
  private message='等待上传服务就绪。'
  private storageFailed=false
  private listeners=new Set<()=>void>()
  private dirty=new Map<string,QueueItem>()
  private deferredWrites=new Map<string,QueueBatch>()
  private timer?:ReturnType<typeof setTimeout>
  private timerAt=0
  readonly ready:Promise<void>
  constructor(private auth: AuthManager){
    chrome.storage.onChanged.addListener((_changes, area)=>{if(area==='local')this.wake()})
    chrome.alarms?.onAlarm.addListener(alarm=>{if(alarm.name==='nexofolio-upload')this.wake()})
    void chrome.alarms?.create('nexofolio-upload',{periodInMinutes:0.5})
    this.ready=this.restore();void this.ready.catch(()=>{this.storageFailed=true;this.message='上传队列无法读取，已暂停新增采集。';this.notify()})}
  observationState(id:string):ObservationUploadState {
    const item=this.items.get(id)
    if(this.confirmed.has(id))return {state:'confirmed',message:'已确认'}
    if(item?.state==='failed')return {state:'failed',message:`被拒绝：${rejectionReason(item.failure)}`}
    if(this.sending.has(id))return {state:'sending',message:'待上传，正在发送'}
    if(item && item.state!=='draft')return {state:'queued',message:'待上传'}
    return {state:'collecting',message:'采集中'}
  }
  private hasCredits(){return [...this.reservations.keys()].some(id=>!this.items.has(id))}
  onChange(fn:()=>void){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
  private notify(){for(const fn of this.listeners)fn()}
  private bytes(){return [...this.items.values()].reduce((sum,item)=>sum+item.size,0)}
  status():QueueStatus {
    const reasons=new Map<string,number>();for(const item of this.items.values())if(item.state==='failed'){const reason=item.failure||'UNKNOWN';reasons.set(reason,(reasons.get(reason)||0)+1)}
    return {failures:[...reasons].map(([reason,count])=>({reason,count})),pending:[...this.items.values()].filter(i=>i.state!=='failed').length,failed:[...this.items.values()].filter(i=>i.state==='failed').length,bytes:this.bytes(),paused:!versionAllowed()||this.storageFailed||(!this.canReserve()&&!this.hasCredits()),message:this.message}
  }
  private reservedBytes(){return [...this.reservations.values()].reduce((sum,bytes)=>sum+bytes,0)}
  private canReserve(){return this.items.size+this.reservations.size<MAX_QUEUE_ITEMS && this.bytes()+this.reservedBytes()+RESERVATION_BYTES<=MAX_QUEUE_BYTES}
  terminalStored(id:string){return !this.dirty.has(id) && this.items.get(id)?.state!=='draft'}
  reserve():string|null {
    if(!versionAllowed()||!this.producer||this.storageFailed||!this.canReserve())return null
    const id=crypto.randomUUID();this.reservations.set(id,RESERVATION_BYTES);return id
  }
  release(id:string){this.reservations.delete(id)}
  private exclusive<T>(fn:()=>Promise<T>):Promise<T>{const work=this.serial.then(fn,fn);this.serial=work.catch(()=>{});return work}
  private async restore(){
    const saved=await this.store.all();this.producer=saved.instanceId||crypto.randomUUID()
    if(!saved.instanceId)await this.store.write({instanceId:this.producer})
    const changed:QueueItem[]=[]
    // Preserve historical batches byte-for-byte. Unsupported legacy entries stay
    // on disk; a version policy is never permission to migrate or delete them.
    for(const batch of saved.batches)this.batches.set(batch.id,batch)
    for(const item of saved.items){
      if(item.format==='collect-v1'&&item.state==='draft'){
        item.observation=interrupted(item.observation!);this.finalize(item);changed.push(item)
      }
      this.items.set(item.id,item)
    }
    if(changed.length)await this.store.write({items:changed})
    this.notify();this.wake()
  }
  private finalize(item:QueueItem){
    if(!terminal(item.observation!))return
    item.record=convert(item.observation!,item.id,this.producer)
    item.failure=recordFailure(item.record,item.destination)||undefined
    item.state=item.failure?'failed':'ready';item.size=encodedSize(item)
  }
  async save(id:string,destination:Destination,value:Observation):Promise<void>{
    // Snapshot before entering the async write queue: callers may mutate their UI object.
    const admitted=versionAllowed()
    const observation=structuredClone(value), scope=structuredClone(destination)
    return this.exclusive(async()=>{
      await this.ready
      const previous=this.items.get(id)
      if(!previous&&!admitted)return
      if(previous && previous.state!=='draft')return // immutable terminal record
      if(!previous&&!this.reservations.has(id))throw new Error('QUEUE_RESERVATION_REQUIRED')
      const item:QueueItem={format:'collect-v1',platformVersion:previous?.platformVersion || observation.platformVersion,id,destination:scope,observation,createdAt:previous?.createdAt||Date.now(),size:0,state:'draft'}
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
  wake(){
    if(!versionAllowed())return
    const now=Date.now(), deadlines=this.deadlines()
    const ready=[...this.items.values()].filter(item=>item.state==='ready'&&(deadlines.get(item.destination.serviceUrl)||0)<=now)
    const urgent=ready.length>=MAX_RECORDS||ready.reduce((sum,item)=>sum+item.size,0)>=4*1024*1024
    const next=Math.min(...[...this.batches.values()].filter(b=>b.wire&&'platform' in b.wire).map(b=>Math.max(b.nextAttempt,deadlines.get(b.destination.serviceUrl)||0)))
    const delay=this.dirty.size||this.deferredWrites.size||ready.length?urgent?0:1000:Math.max(1000,next-now)
    if(!Number.isFinite(delay)||(this.timer&&this.timerAt<=now+delay))return
    clearTimeout(this.timer);this.timerAt=now+Math.min(delay,2147483647)
    this.timer=setTimeout(()=>{this.timer=undefined;void this.flush()},Math.min(delay,2147483647))
  }
  private deadlines(){
    const result=new Map<string,number>()
    for(const batch of this.batches.values())result.set(batch.destination.serviceUrl,Math.max(result.get(batch.destination.serviceUrl)||0,batch.nextAttempt))
    return result
  }
  // Items of a batch go back to their own state in one write; the batch row goes with them.
  private async settle(active:QueueBatch,updates:QueueItem[],deletes:string[]=[],batches:QueueBatch[]=[]){
    await this.exclusive(async()=>{
      await this.store.write({items:updates,deleteItems:deletes,deleteBatches:[active.id],batches})
      this.batches.delete(active.id)
      for(const next of batches)this.batches.set(next.id,next)
      for(const item of updates)this.items.set(item.id,item)
      for(const id of deletes){this.items.delete(id);this.confirmed.add(id)}
      while(this.confirmed.size>500){const oldest=this.confirmed.values().next().value;if(oldest)this.confirmed.delete(oldest)}
    })
  }
  private rebatch(active:QueueBatch,ids:string[]):QueueBatch{
    const wire=batchOf(active.destination,ids.map(id=>this.items.get(id)!.record!),undefined,active.wire.platform_version)
    return {id:wire.batch_id,destination:active.destination,itemIds:ids,wire,attempts:0,nextAttempt:0}
  }
  private failAll(active:QueueBatch,failure:string){return this.settle(active,active.itemIds.map(id=>({...this.items.get(id)!,state:'failed' as const,failure})))}
  private async defer(active:QueueBatch,error:unknown){
    const attempts=active.attempts+1,delay=retryDelay(attempts,error instanceof ApiError?error.retryAfterMs:undefined)
    const deferred={...active,attempts,nextAttempt:Date.now()+delay}
    this.batches.set(deferred.id,deferred);this.deferredWrites.set(deferred.id,deferred)
    try {await this.store.write({batches:[deferred]});this.deferredWrites.delete(deferred.id)}
    catch {this.storageFailed=true;throw new Error('QUEUE_STORAGE_UNAVAILABLE')}
  }
  private async flush(){
    if(this.running)return
    this.running=true
    let attempted=false
    try {
      await this.ready
      if(this.dirty.size||this.deferredWrites.size){await this.exclusive(async()=>{await this.store.write({items:[...this.dirty.values()],batches:[...this.deferredWrites.values()]});this.dirty.clear();this.deferredWrites.clear();this.storageFailed=false})}
      if (!versionAllowed() || !this.transportEnabled) { this.message='上传服务初始化中，队列保留。'; return }
      const state=await this.auth.snapshot(),now=Date.now(),deadlines=this.deadlines()
      const eligible=(d:Destination)=>state.status==='authenticated'&&state.service?.url===d.serviceUrl&&state.user?.id===d.userId&&(deadlines.get(d.serviceUrl)||0)<=now
      let batch=[...this.batches.values()].find(b=>b.wire && 'platform' in b.wire && eligible(b.destination)&&b.nextAttempt<=now)
      if(!batch)batch=await this.exclusive(async()=>{
        if(!versionAllowed())return undefined
        const first=[...this.items.values()].find(i=>i.format==='collect-v1'&&i.state==='ready'&&eligible(i.destination))
        if(!first)return undefined
        const selected:QueueItem[]=[]
        let bytes=0
        for(const item of this.items.values()){
          if(item.format!=='collect-v1'||item.destination.userId!==first.destination.userId||item.platformVersion!==first.platformVersion||item.state!=='ready'||groupKey(item.destination)!==groupKey(first.destination))continue
          const size=encodedSize(item.record)
          if(selected.length&&(selected.length>=MAX_RECORDS||bytes+size>BATCH_TARGET_BYTES))break
          selected.push(item);bytes+=size
        }
        const wire=batchOf(first.destination,selected.map(i=>i.record!),undefined,first.platformVersion)
        const created:QueueBatch={id:wire.batch_id,destination:first.destination,itemIds:selected.map(i=>i.id),wire,attempts:0,nextAttempt:0}
        const updates=selected.map(i=>({...i,state:'batched' as const}))
        await this.store.write({items:updates,batches:[created]})
        for(const item of updates)this.items.set(item.id,item)
        this.batches.set(created.id,created);return created
      })
      if(!batch){this.message=this.items.size?'原队列保留，等待重试时间或对应服务与账号就绪。':'已全部交给接收服务。';return}
      if(!versionAllowed())return
      const active=batch
      attempted=true
      try {
        for(const id of active.itemIds)this.sending.add(id)
        this.notify()
        // A retry sends the stored wire unchanged, so the batch id is reused and the server counts it once.
        const receipt=await this.auth.withSession(async access=>{
          if(access.service.url!==active.destination.serviceUrl||access.userId!==active.destination.userId)throw new ApiError('stale','上传身份已变化。')
          access.assertCurrent()
          return submitBatch(active.destination.serviceUrl,active.wire,this.producer,access.signal)
        })
        const rejected=rejections(receipt,active.wire)
        const updates:QueueItem[]=[],deletes:string[]=[]
        active.itemIds.forEach((id,index)=>{
          const reason=rejected.get(index)
          if(reason)updates.push({...this.items.get(id)!,state:'failed',failure:reason})
          else deletes.push(id)
        })
        await this.settle(active,updates,deletes)
        this.message=updates.length?'接收服务已确认；部分记录被拒绝，原始记录保留为失败状态。':'接收服务已确认。'
      } catch(error){
        const status=error instanceof ApiError?error.status:undefined, code=error instanceof ApiError?error.code:''
        if(error instanceof ApiError && error.kind==='update'){
          await this.defer(active,error)
          this.message='运行版本未获准上传，原批次与记录保留，等待 OSS 校验恢复。'
        } else if(status===413){
          if(active.itemIds.length===1)await this.failAll(active,'RECORD_TOO_LARGE')
          else {
            const half=Math.ceil(active.itemIds.length/2)
            await this.settle(active,[],[],[this.rebatch(active,active.itemIds.slice(0,half)),this.rebatch(active,active.itemIds.slice(half))])
          }
          this.message='超限批次已拆分，超限单条保留为失败记录。'
        } else if(status===404&&(code==='UNKNOWN_PROJECT'||code==='UNKNOWN_ENVIRONMENT')){
          await this.failAll(active,code)
          this.message=code==='UNKNOWN_PROJECT'?'服务上找不到该项目，记录保留为失败状态。':'服务上找不到该环境，记录保留为失败状态。'
        } else if(status===400){
          await this.failAll(active,'INVALID_BATCH')
          this.message='接收服务拒绝该批次，原始记录保留为失败状态。'
        } else if(status===409){
          // The id was already used for different content; the same records go out again under a new id.
          await this.settle(active,[],[],[this.rebatch(active,active.itemIds)])
          this.message='批次编号冲突，已换新编号重发。'
        } else {
          await this.defer(active,error)
          this.message=status===429||status===503?'接收服务繁忙，原批次保留，稍后重试。':'上传未确认，原批次和记录保留，稍后重试。'
        }
      }
    } catch {this.message=this.storageFailed?'队列存储失败，新增采集已暂停。':'上传服务暂未就绪，队列保留。'}
    finally {this.sending.clear();this.running=false;this.notify();if(attempted)this.wake()}
  }
}
