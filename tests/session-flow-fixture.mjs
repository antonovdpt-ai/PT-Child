// INTERMEDIATE snapshot: after equality/single mocking fix, before final onQuery response override support.
import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
import {escapeHtml} from '../security-utils.mjs';
export const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
export const branch=source.slice(source.indexOf("  if (state.tab === 'sessions') {"),source.indexOf("  if (state.tab === 'progress') {"));
export const helpers=source.slice(source.indexOf('// Keep these two pure validators'),source.indexOf('async function analyzeSessionDraft'));
export const validPlan={main_task:'Удержание опоры',start_check:{action:'Проверить боль. Оценить поддержку.',why:'Сравнение'},work_blocks:[{title:'Перенос веса у опоры',action:'Специалист поддерживает таз; ребёнок тянется к игрушке стоя.',why:'Контроль опоры',progress_if:'Устойчивая опора при меньшей помощи'}],what_to_track:['Поддержка таза'],session_success_criteria:['Меньше поддержки в той же активности'],cautions:[],needs_review:true};
export function fixture({patient={id:'child'},sessions=[],draft,plan=validPlan,error=null,onQuery=async()=>{}}={}){
 const window=new Window(),document=window.document,box=document.createElement('div');document.body.append(box);
 window.HTMLElement.prototype.scrollIntoView=function(){};
 const db={patients:{[patient.id]:{therapist_id:'specialist',...structuredClone(patient)}},sessions:structuredClone(sessions)};const calls=[];
 const state={patientId:patient.id,tab:'sessions',goals:[],sessions:structuredClone(sessions)};
 const p=structuredClone(patient);
 const env={window,document,box,p,state,esc:escapeHtml,user:{id:'specialist'},accountUserId:'specialist',FormData:window.FormData,
 accountRevision:1,authViewRevision:1,roleGate:{canNavigate:()=>true},accountIsCurrent:()=>state.patientId===p.id&&box.isConnected,watchFormDirty(){},enableVoiceInput(){},fmtDate:x=>x,toleranceLabel:x=>x||'',sessionDynamicsHtml:()=>'',plannedSessionHtml:x=>x?`<div>${escapeHtml(x.main_task)}</div>`:'',renderParentSessionReportEditor(){},refreshParentControls(){},SUPABASE_URL:'https://example.test',
 analyzeSessionDraft:async()=>draft||{session_note:'Работали лёжа с помощью',tolerance:null,dynamics_status:null,function_changes:'',goal_updates:[]},prepareNextSessionPlan:async()=>structuredClone(plan),confirm:()=>true,console,flash:(type,msg)=>{env.message=msg;},
 setButtonSaving:b=>{b.disabled=true;},setButtonError:b=>{b.disabled=false;},setButtonSaved:b=>{b.disabled=true;},sleep:async()=>{},loadPatientData:async()=>{state.sessions=structuredClone(db.sessions);},renderPatient(){},
 sb:{from(table){let op,payload,filters=[],single=false;const q={update(v){op='update';payload=v;return q;},insert(v){op='insert';payload=v;return q;},eq(k,v){filters.push([k,v]);return q;},is(k,v){filters.push([k,v]);return q;},select(){return q;},single(){single=true;return q;},then(resolve,reject){return (async()=>{
 const call={table,op,payload:structuredClone(payload),filters};calls.push(call);const overridden=await onQuery(call,db,env);if(overridden!==undefined)return overridden;
 if(error)return {error,data:null};
 const matches=row=>filters.every(([key,value])=>key==='next_session_plan'?JSON.stringify(row[key]??null)===(typeof value==='string'?value:JSON.stringify(value)):row[key]===value);
 let data=[];
 if(table==='patients'){
  const rows=Object.values(db.patients).filter(matches);
  for(const row of rows){if(op==='update')Object.assign(row,structuredClone(payload));data.push(structuredClone(row));}
 }else if(table==='sessions'){
  if(op==='insert'){data=[{...structuredClone(payload),id:'new-session'}];db.sessions.push(data[0]);}
  else {const rows=db.sessions.filter(matches);for(const row of rows){if(op==='update')Object.assign(row,structuredClone(payload));data.push(structuredClone(row));}}
 }
 return single?data.length===1?{data:data[0],error:null}:{data:null,error:{message:'Expected one row'}}:{data,error:null};
 })().then(resolve,reject);}};return q;}}
 };
 const render=()=>new Function('env',`with(env){${helpers}\n${branch}}`)(env);render();
 return {window,document,box,p,state,env,db,calls,render,close:()=>window.happyDOM.abort()};
}

