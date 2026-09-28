import type { QueueBatch, QueueItem, QueueAsset } from './contracts'
export class QueueStore {
  private db?: Promise<IDBDatabase>
  private open() {
    return this.db ??= new Promise((resolve,reject)=>{
      const request=indexedDB.open('nexofolio-upload-v1',2)
      request.onupgradeneeded=()=>{ for(const name of ['items','batches','meta','assets']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name,{keyPath:'id'}) }
      request.onerror=()=>{this.db=undefined;reject(new Error('QUEUE_STORAGE_UNAVAILABLE'))}
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();this.db=undefined};resolve(db)}
    })
  }
  async all() {
    const db=await this.open()
    return new Promise<{items:QueueItem[];batches:QueueBatch[];assets:QueueAsset[];instanceId?:string}>((resolve,reject)=>{
      const tx=db.transaction(['items','batches','meta','assets'],'readonly')
      const assets=tx.objectStore('assets').getAll(),items=tx.objectStore('items').getAll(),batches=tx.objectStore('batches').getAll(),meta=tx.objectStore('meta').get('producer')
      tx.oncomplete=()=>resolve({items:items.result,batches:batches.result,assets:assets.result,instanceId:meta.result?.value})
      tx.onabort=tx.onerror=()=>reject(new Error('QUEUE_STORAGE_UNAVAILABLE'))
    })
  }
  async write(change:{assets?:QueueAsset[];deleteAssets?:string[];items?:QueueItem[];deleteItems?:string[];batches?:QueueBatch[];deleteBatches?:string[];instanceId?:string}) {
    const db=await this.open()
    return new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['items','batches','meta','assets'],'readwrite',{durability:'strict'})
      for(const asset of change.assets||[])tx.objectStore('assets').put(asset)
      for(const id of change.deleteAssets||[])tx.objectStore('assets').delete(id)
      for(const item of change.items||[])tx.objectStore('items').put(item)
      for(const id of change.deleteItems||[])tx.objectStore('items').delete(id)
      for(const batch of change.batches||[])tx.objectStore('batches').put(batch)
      for(const id of change.deleteBatches||[])tx.objectStore('batches').delete(id)
      if(change.instanceId)tx.objectStore('meta').put({id:'producer',value:change.instanceId})
      tx.oncomplete=()=>resolve()
      tx.onabort=tx.onerror=()=>reject(new Error('QUEUE_STORAGE_UNAVAILABLE'))
    })
  }
}
