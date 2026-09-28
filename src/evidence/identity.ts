import { isUuid } from '../api/nexofolio/client'
import type { ContextSeed } from './context'
const KEY='nexofolio.capture.browser-session-v1'
type IdentityState={browserId:string;pages:Record<string,string>;frames:Record<string,string>}
export class CaptureIdentity {
  private state:IdentityState={browserId:'',pages:{},frames:{}}
  readonly ready:Promise<void>
  private writes:Promise<unknown>=Promise.resolve()
  constructor(){this.ready=this.restore()}
  private async restore(){
    const value=(await chrome.storage.session.get(KEY))[KEY] as Partial<IdentityState>|undefined
    const mapping=(value:unknown):Record<string,string>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,string>:{}
    this.state=value&&isUuid(value.browserId)
      ?{browserId:value.browserId,pages:mapping(value.pages),frames:mapping(value.frames)}
      :{browserId:crypto.randomUUID(),pages:{},frames:{}}
    await chrome.storage.session.set({[KEY]:this.state})
  }
  async seed(pageDocumentId:string,frameDocumentId:string):Promise<ContextSeed>{
    await this.ready
    // Chrome documentId is an opaque browser identifier (normally 32 hex chars),
    // not the hyphenated UUID required by our wire protocol. Never rewrite it for
    // executeScript/documentIds or runtime sender validation; map it separately.
    if(!pageDocumentId||!frameDocumentId)throw new Error('无法读取当前页面文档标识。')
    const operation=this.writes.then(async()=>{
      if(!isUuid(this.state.pages[pageDocumentId])||!isUuid(this.state.frames[frameDocumentId])){
        const next:IdentityState={browserId:this.state.browserId,pages:{...this.state.pages},frames:{...this.state.frames}}
        if(!isUuid(next.pages[pageDocumentId]))next.pages[pageDocumentId]=crypto.randomUUID()
        if(!isUuid(next.frames[frameDocumentId]))next.frames[frameDocumentId]=crypto.randomUUID()
        for(const mapping of [next.pages,next.frames]){
          const keys=Object.keys(mapping)
          for(const key of keys.slice(0,Math.max(0,keys.length-1000)))delete mapping[key]
        }
        await chrome.storage.session.set({[KEY]:next})
        this.state=next
      }
      return {browser_instance_id:this.state.browserId,page_instance_id:this.state.pages[pageDocumentId]!,frame_instance_id:this.state.frames[frameDocumentId]!,view_id:crypto.randomUUID()}
    })
    this.writes=operation.catch(()=>{})
    return operation
  }
}
