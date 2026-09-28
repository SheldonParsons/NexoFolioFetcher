import type { QueueBatch, QueueItem } from './contracts'
export class QueueStore {
  private db?: Promise<IDBDatabase>
  private open() {
    return this.db ??= new Promise((resolve,reject)=>{
      const request=indexedDB.open('nexofolio-upload-v1',2)
      // The assets store is left over from screenshot uploads; kept so opening the DB never needs an upgrade.
      request.onupgradeneeded=()=>{ for(const name of ['items','batches','meta','assets']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name,{keyPath:'id'}) }
      request.onerror=()=>{this.db=undefined;reject(new Error('QUEUE_STORAGE_UNAVAILABLE'))}
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();this.db=undefined};resolve(db)}
    })
  }
  async all() {
    const db=await this.open()
    return new Promise<{items:QueueItem[];batches:QueueBatch[];instanceId?:string}>((resolve,reject)=>{
      const tx=db.transaction(['items','batches','meta'],'readonly')
      const items=tx.objectStore('items').getAll(),batches=tx.objectStore('batches').getAll(),meta=tx.objectStore('meta').get('producer')
      tx.oncomplete=()=>resolve({items:items.result,batches:batches.result,instanceId:meta.result?.value})
      tx.onabort=tx.onerror=()=>reject(new Error('QUEUE_STORAGE_UNAVAILABLE'))
    })
  }
  async write(change:{items?:QueueItem[];deleteItems?:string[];batches?:QueueBatch[];deleteBatches?:string[];instanceId?:string}) {
    const db=await this.open()
    return new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['items','batches','meta'],'readwrite',{durability:'strict'})
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
