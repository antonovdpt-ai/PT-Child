import test from 'node:test';import assert from 'node:assert/strict';import {Window} from 'happy-dom';
import {renderParentSessionReportEditor} from '../parent-specialist.js';
test('editing during async save cannot approve export of different persisted text',async()=>{
 const window=new Window(),root=window.document.createElement('main');window.document.body.append(root);window.confirm=()=>true;
 const report={id:'saved-report',patient_id:'child',therapist_id:'owner',session_id:'session',publication_status:'draft',what_did:'First saved text'};
 let finish,started;const waiting=new Promise(r=>started=r),calls=[];
 const sb={from(table){let op='select',one=false,payload;const q={select(){return q},eq(){return q},order(){return q},single(){one=true;return q},update(v){op='update';payload=v;return q},delete(){op='delete';return q},then(resolve,reject){return (async()=>{if(op==='update'){started();await new Promise(r=>finish=r);Object.assign(report,payload);}return {data:table==='parent_session_reports'?(one?structuredClone(report):[structuredClone(report)]):[]};})().then(resolve,reject)}};return q;},functions:{invoke:async(name,{body})=>{calls.push({name,body});return {data:new Blob(['%PDF-1.7\nfictional'],{type:'application/pdf'})};}}};
 try{
  await renderParentSessionReportEditor({root,sb,user:{id:'owner'},patient:{id:'child',therapist_id:'owner'},session:{id:'session',patient_id:'child',therapist_id:'owner'},isCurrent:()=>true});
  const text=root.querySelector('[name=what_did]');text.value='Captured before save';text.dispatchEvent(new window.Event('input',{bubbles:true}));const pending=root.querySelector('[data-save-report]').onclick();await waiting;
  text.value='Unsaved edit during save';text.dispatchEvent(new window.Event('input',{bubbles:true}));finish();await pending;
  assert.equal(report.what_did,'Captured before save');assert.equal(text.value,'Unsaved edit during save');await root.querySelector('[data-prepare-pdf]').onclick();assert.match(root.textContent,/Сначала сохраните/);assert.equal(calls.length,0);assert.equal(root.querySelector('[data-share-pdf]').disabled,true);
 }finally{await window.happyDOM.abort();}
});
