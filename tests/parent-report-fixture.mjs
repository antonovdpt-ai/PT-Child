import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
const owner='fictional-specialist',child='fictional-child';
const keys=['complaint','strengths','observations','goals','progress','recommendations'];
export async function workspaceFixture(options={}) {
 const {mountParentReportWorkspace}=await import('../parent-report-workspace.mjs');
 const window=new Window(),document=window.document,root=document.createElement('main');document.body.append(root);
 window.HTMLElement.prototype.scrollIntoView=()=>{};window.confirm=()=>{throw Error('Unexpected confirmation');};
 window.URL.createObjectURL=()=> 'blob:fictional-pdf';window.URL.revokeObjectURL=()=>{};
 const rows=structuredClone(options.reports||[]),calls=[];let current=true,failSave=options.failSave;
 const sb={from(table){assert.equal(table,'parent_reports');let operation='select',payload,filters=[];
  const q={insert(v){operation='insert';payload=structuredClone(v);return q},update(v){operation='update';payload=structuredClone(v);return q},delete(){operation='delete';return q},select(){return q},eq(k,v){filters.push([k,v]);return q},single(){return q},then(resolve,reject){return (async()=>{
   if(operation!=='select'){calls.push({operation,payload,filters});await options.beforeWrite?.(operation,payload);if(failSave)return {error:{message:'synthetic failure'}};}
   let row=rows.find(r=>filters.every(([k,v])=>r[k]===v));
   if(operation==='insert'){row={...payload,id:`report-${rows.length+1}`,publication_status:'draft',created_at:'2026-10-08T12:00:00Z'};rows.push(row);}
   if(operation==='update'){if(!row)return {error:{message:'CAS rejected'}};Object.assign(row,payload);}
   if(operation==='delete'){if(row)rows.splice(rows.indexOf(row),1);return {data:null};}
   return {data:row?structuredClone(row):null,error:row?null:{message:'not found'}};
  })().then(resolve,reject)}};return q;},functions:{invoke:async(name,{body})=>{calls.push({name,body});return {data:new Blob(['%PDF-1.7\nfictional'],{type:'application/pdf'})}}}};
 const flow=mountParentReportWorkspace({root,sb,patient:{id:child,therapist_id:owner,display_name:'Вымышленный ребёнок'},specialist:{id:owner,full_name:'Анна Тестовая'},profile:{full_name:'Анна Тестовая',profession:'Физический терапевт',phone:'+7 000'},reports:rows,prepareDraft:options.prepareDraft|| (async()=>({complaint:'Причина обращения',observations:'Фиктивные наблюдения',recommendations:'Рекомендации домой'})),isCurrent:()=>current,onSaved:options.onSaved});
 const input=(key,value)=>{const field=root.querySelector(`[name="${key}"]`);field.value=value;field.dispatchEvent(new window.Event('input',{bubbles:true}));};
 return {window,document,root,rows,calls,flow,input,retire(){current=false;flow.dispose();},setFailSave(value){failSave=value;},async close(){flow.dispose();await window.happyDOM.abort();}};
}
