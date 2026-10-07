import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {escapeHtml} from '../security-utils.mjs';
const source=await readFile(process.env.GOAL_UI_BASELINE_PATH||new URL('../app.js',import.meta.url),'utf8');
const start=source.indexOf("  if (state.tab === 'goals') {"),end=source.indexOf("  if (state.tab === 'sessions') {",start);
async function fixture(goals=[],error=null){
 const window=new Window(),document=window.document,box=document.createElement('div');document.body.append(box);
 const calls=[];let reloads=0;
 const state={patientId:'child',tab:'goals',goals};
 const env={window,document,box,state,p:{id:'child'},esc:escapeHtml,FormData:window.FormData,crypto,
  accountIsCurrent:()=>true,watchFormDirty:()=>{},confirm:()=>true,
  goalsHtml:rows=>rows.map(g=>`<button data-edit-goal="${g.id}">Изменить</button><button data-visibility-goal="${g.id}">Видимость</button><button data-complete-goal="${g.id}">Завершить</button>`).join(''),
  loadPatientData:async()=>{reloads++;},renderPatient:()=>{},
  sb:{from(table){let payload,op,filters=[];const q={insert(p){op='insert';payload=p;return q;},update(p){op='update';payload=p;return q;},eq(k,v){filters.push([k,v]);return q;},select(){return q;},single:async()=>{calls.push({table,op,payload,filters});return {data:{id:payload?.id||'goal'},error};}};return q;}}
 };
 new Function('env',`with(env){${source.slice(start,end)}}`)(env);
 assert.ok(box.querySelector('[name=parent_visible]'),'ordinary editor must contain the explicit parent control');
 return {window,document,box,state,calls,env,get reloads(){return reloads;},close(){window.happyDOM.abort();}};
}
const submit=h=>h.box.querySelector('#goalForm').onsubmit({preventDefault(){}});
test('session suggestion saves its displayed version even after goal state refresh',async()=>{
 const goal={id:'goal',updated_at:'2026-10-06T10:00:00Z'};
 const applyStart=source.indexOf('  applyBtn.onclick = () => {',source.indexOf('let pendingGoalUpdates = []'));
 const applyEnd=source.indexOf('  ignoreBtn.onclick =',applyStart);
 const env={goal,suggestedProgress:60,pendingGoalUpdates:[],applyBtn:{},ignoreBtn:{}};
 new Function('env',`with(env){${source.slice(applyStart,applyEnd)}}`)(env);
 env.applyBtn.onclick();
 assert.equal(env.pendingGoalUpdates[0].updated_at,goal.updated_at);
 const filters=[];
 const q={update(){return q;},eq(k,v){filters.push([k,v]);return q;},select(){return q;},single:async()=>({error:null})};
 Object.assign(env,{goalUpdatesToSave:env.pendingGoalUpdates,sessionAccountIsCurrent:()=>true,state:{goals:[{...goal,updated_at:'2026-10-06T11:00:00Z'}]},p:{id:'child'},sb:{from:()=>q},accountIsCurrent:()=>true,console});
 const saveStart=source.indexOf('for (const update of goalUpdatesToSave) {');
 const saveEnd=source.indexOf('if (!editingSessionId && p.next_session_plan)',saveStart);
 await new Function('env',`return (async()=>{with(env){let goalUpdateFailed=false;${source.slice(saveStart,saveEnd)}}})();`)(env);
 assert.ok(filters.some(([k,v])=>k==='updated_at'&&v===goal.updated_at));
});
test('ordinary form saves private by default and gives unambiguous parent visibility feedback',async()=>{
 const h=await fixture();try{h.box.querySelector('[name=title]').value='Открывать дверь';await submit(h);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].table,'goals');assert.equal(h.calls[0].payload.parent_visible,false);
  assert.match(h.box.textContent,/Цель сохранена · не опубликована родителю/);
  await submit(h);assert.equal(h.calls.length,1,'persisted insert cannot be repeated');
 }finally{h.close();}
});
test('ordinary form explicitly publishes and preserves complete safe inputs in one clinical write',async()=>{
 const h=await fixture();try{const form=h.box.querySelector('#goalForm');for(const [k,v] of Object.entries({title:'Открывать дверь',baseline:'Не может',criterion:'Три попытки',deadline:'2027-01-01',progress:'100'}))form.elements[k].value=v;
  form.elements.parent_visible.checked=true;await submit(h);assert.equal(h.calls.length,1);assert.equal(h.calls[0].payload.status,'achieved');assert.equal(h.calls[0].payload.parent_visible,true);assert.equal(h.calls[0].payload.progress,100);
  assert.match(h.box.textContent,/Цель сохранена и опубликована родителю/);
 }finally{h.close();}
});
test('editing retains private/public visibility and paused clinical status',async()=>{
 for(const visible of [false,true]){const h=await fixture([{id:'goal',title:'Цель',baseline:'Исходно',criterion:'Критерий',progress:40,status:'paused',parent_visible:visible}]);try{
  h.box.querySelector('[data-edit-goal]').click();assert.equal(h.box.querySelector('[name=parent_visible]').checked,visible);
  h.box.querySelector('[name=title]').value='Изменено';await submit(h);assert.equal(h.calls[0].op,'update');assert.equal(h.calls[0].payload.parent_visible,visible);assert.equal(h.calls[0].payload.status,'paused');
 }finally{h.close();}}
});
test('failed save retains form and stable creation ID when retrying',async()=>{
 const h=await fixture([],{message:'network'});try{h.box.querySelector('[name=title]').value='Не потерять';h.box.querySelector('[name=parent_visible]').checked=true;await submit(h);await submit(h);
  assert.equal(h.box.querySelector('[name=title]').value,'Не потерять');assert.equal(h.box.querySelector('[name=parent_visible]').checked,true);
  assert.equal(h.calls[0].payload.id,h.calls[1].payload.id);assert.match(h.box.textContent,/Не удалось сохранить/);assert.equal(h.box.querySelector('#goalSaveBtn').disabled,false);
 }finally{h.close();}
});
test('detached goal editor or switched child cannot save, publish or complete the old goal',async()=>{
 const h=await fixture([{id:'goal',title:'Цель',progress:40,status:'active',parent_visible:false}]);try{
  const visibility=h.box.querySelector('[data-visibility-goal]'),complete=h.box.querySelector('[data-complete-goal]');
  h.box.querySelector('[name=title]').value='Stale';h.state.patientId='other';await submit(h);await visibility.onclick();await complete.onclick();assert.equal(h.calls.length,0);
  h.state.patientId='child';h.box.remove();await submit(h);await visibility.onclick();assert.equal(h.calls.length,0);
 }finally{h.close();}
});
test('editor preserves achieved100 and sends captured version to reject concurrent edits',async()=>{
 const version='2026-10-06T10:00:00Z';
 const h=await fixture([{id:'goal',title:'Цель',progress:100,status:'achieved',updated_at:version,parent_visible:true,parent_note:'Ранее опубликованное дополнение'}]);try{
  h.box.querySelector('[data-edit-goal]').click();assert.equal(h.box.querySelector('[name=progress]').readOnly,true);
  assert.equal(h.box.querySelector('[name=parent_note]').value,'Ранее опубликованное дополнение');
  h.state.goals[0].updated_at='2026-10-06T11:00:00Z';await submit(h);
  assert.ok(h.calls[0].filters.some(([k,v])=>k==='updated_at'&&v===version));
 }finally{h.close();}
});
