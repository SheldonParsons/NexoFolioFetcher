import { object } from '../api/nexofolio/client'
import type { CaptureRecord, UiElement, UiValue, PageContextPayload } from '../contracts/capture/types.generated'
import type { EvidenceContext } from './context'
const value = (input:unknown, present:boolean):UiValue => present ? {state:'present',value:input} : {state:'unknown',value:null}
export function elementFrom(input:unknown):UiElement {
  const data=object(input), bounds=object(data.bounds)
  return { element_id:typeof data.element_id==='string'?data.element_id:crypto.randomUUID(),tag:String(data.tag||'unknown'),role:typeof data.role==='string'?data.role:null,name:typeof data.name==='string'?data.name:null,label:typeof data.label==='string'?data.label:null,visible:true,
    bounds:['x','y','width','height'].every(k=>typeof bounds[k]==='number'&&Number.isFinite(bounds[k]))?bounds as unknown as UiElement['bounds']:null,
    value:data.value_unavailable?{state:'unknown',value:null}:'checked' in data?value(data.checked,true):value(data.value,'value' in data),
    options:(Array.isArray(data.visible_options)?data.visible_options:Array.isArray(data.selected_options)?data.selected_options:[]).slice(0,100).map(option=>{const item=object(option);return {label:String(item.text||''),selected:'selected' in item?item.selected===true:true,value:value(item.value,'value' in item)}}) }
}
export function pagePayload(url:string,title:string,limitations:string[]):PageContextPayload {return {url,title,breadcrumbs:[],regions:[],complete:false,limitations}}
export function validObservedTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000
}
export function evidenceRecord(kind:CaptureRecord['kind'],context:EvidenceContext,payload:unknown,time:number):CaptureRecord {
  if (!validObservedTime(time)) throw new Error('INVALID_OBSERVED_TIME')
  return {record_id:crypto.randomUUID(),kind,payload_version:'1',captured_at:new Date(time).toISOString(),context,payload}
}
