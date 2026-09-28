import { ApiError } from '../api/nexofolio/client'
import { submitBatch } from '../api/nexofolio/collect'
import { QueueStore } from './store'
import { batchOf, convert, interrupted, recordFailure, rejections, terminal } from './converter'
import { groupKey, encodedSize, BATCH_TARGET_BYTES, MAX_QUEUE_BYTES, MAX_QUEUE_ITEMS, MAX_RECORDS, RESERVATION_BYTES, type Destination, type Observation, type QueueBatch, type QueueItem, type QueueStatus, type ObservationUploadState } from './contracts'

// Uploading is decoupled from login: every item carries its own destination and collect needs no token.
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
  enableTransport(){this.transportEnabled=true;this.wake()}
  private message='等待上传服务就绪。'
  private storageFailed=false
  private listeners=new Set<()=>void>()
  private dirty=new Map<string,QueueItem>()
  private timer?:ReturnType<typeof setTimeout>
  readonly ready:Promise<void>
  constructor(){
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
  private bytes(){return [...this.items.values()].reduce((sum,item)=>sum+item.size,0)}
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
    const changed:QueueItem[]=[],staleBatches:string[]=[]
    // Batches built for the old ingestion wire are dropped; their items go back to ready and are rebatched.
    const stale=new Set<string>()
    for(const batch of saved.batches){
      if(batch.wire && 'platform' in batch.wire)this.batches.set(batch.id,batch)
      else {staleBatches.push(batch.id);for(const id of batch.itemIds||[])stale.add(id)}
    }
    for(const saved_ of saved.items){
      let item=saved_
      if(item.format!=='collect-v1'){
        // Old HTTP items keep their observation and are converted again; evidence-only records have nothing to convert.
        item=item.observation
          ?{format:'collect-v1',id:item.id,destination:item.destination,observation:item.observation,createdAt:item.createdAt,size:0,state:item.state==='draft'?'draft':'ready'}
          :{...item,format:'collect-v1',state:'failed',failure:item.failure||'LEGACY_RECORD'}
        if(item.state==='ready')this.finalize(item)
        changed.push(item)
      } else if(stale.has(item.id)&&item.state==='batched'){item={...item,state:'ready'};changed.push(item)}
      if(item.state==='draft'){item.observation=interrupted(item.observation!);this.finalize(item);changed.push(item)}
      this.items.set(item.id,item)
    }
    if(changed.length||staleBatches.length)await this.store.write({items:changed,deleteBatches:staleBatches})
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
    const observation=structuredClone(value), scope=structuredClone(destination)
    return this.exclusive(async()=>{
      await this.ready
      const previous=this.items.get(id)
      if(previous && previous.state!=='draft')return // immutable terminal record
      if(!previous&&!this.reservations.has(id))throw new Error('QUEUE_RESERVATION_REQUIRED')
      const item:QueueItem={format:'collect-v1',id,destination:scope,observation,createdAt:previous?.createdAt||Date.now(),size:0,state:'draft'}
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
    const ready=[...this.items.values()].filter(item=>item.state==='ready')
    const urgent=ready.length>=MAX_RECORDS||ready.reduce((sum,item)=>sum+item.size,0)>=4*1024*1024
    if(urgent&&this.timer){clearTimeout(this.timer);this.timer=undefined}
    if(!this.timer)this.timer=setTimeout(()=>{this.timer=undefined;void this.flush()},urgent?0:1000)
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
    const wire=batchOf(active.destination,ids.map(id=>this.items.get(id)!.record!))
    return {id:wire.batch_id,destination:active.destination,itemIds:ids,wire,attempts:0,nextAttempt:0}
  }
  private failAll(active:QueueBatch,failure:string){return this.settle(active,active.itemIds.map(id=>({...this.items.get(id)!,state:'failed' as const,failure})))}
  private async flush(){
    if(this.running)return
    this.running=true
    try {
      await this.ready
      if(this.dirty.size){await this.exclusive(async()=>{await this.store.write({items:[...this.dirty.values()]});this.dirty.clear();this.storageFailed=false})}
      if (!this.transportEnabled) { this.message='上传服务初始化中，队列保留。'; return }
      let batch=[...this.batches.values()].find(b=>b.nextAttempt<=Date.now())
      if(!batch)batch=await this.exclusive(async()=>{
        const first=[...this.items.values()].find(i=>i.state==='ready')
        if(!first)return undefined
        const selected:QueueItem[]=[]
        let bytes=0
        for(const item of this.items.values()){
          if(item.state!=='ready'||groupKey(item.destination)!==groupKey(first.destination))continue
          const size=encodedSize(item.record)
          if(selected.length&&(selected.length>=MAX_RECORDS||bytes+size>BATCH_TARGET_BYTES))break
          selected.push(item);bytes+=size
        }
        const wire=batchOf(first.destination,selected.map(i=>i.record!))
        const created:QueueBatch={id:wire.batch_id,destination:first.destination,itemIds:selected.map(i=>i.id),wire,attempts:0,nextAttempt:0}
        const updates=selected.map(i=>({...i,state:'batched' as const}))
        await this.store.write({items:updates,batches:[created]})
        for(const item of updates)this.items.set(item.id,item)
        this.batches.set(created.id,created);return created
      })
      if(!batch){this.message=this.items.size?'失败记录已保留，其余已全部交给接收服务。':'已全部交给接收服务。';return}
      const active=batch
      try {
        for(const id of active.itemIds)this.sending.add(id)
        this.notify()
        // A retry sends the stored wire unchanged, so the batch id is reused and the server counts it once.
        const rejected=rejections(await submitBatch(active.destination.serviceUrl,active.wire),active.wire)
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
        if(status===413){
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
          const attempts=active.attempts+1,delay=Math.max(error instanceof ApiError?error.retryAfterMs||0:0,Math.min(60000,1000*2**Math.min(attempts,6)))
          const deferred={...active,attempts,nextAttempt:Date.now()+Math.min(delay,60000)}
          await this.store.write({batches:[deferred]});this.batches.set(deferred.id,deferred)
          this.message=status===429||status===503?'接收服务繁忙，原批次保留，稍后重试。':'上传未确认，原批次和记录保留，稍后重试。'
        }
      }
    } catch {this.message=this.storageFailed?'队列存储失败，新增采集已暂停。':'上传服务暂未就绪，队列保留。'}
    finally {this.sending.clear();this.running=false;this.notify();if(this.items.size||this.dirty.size){clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=undefined;void this.flush()},1000)}}
  }
}
