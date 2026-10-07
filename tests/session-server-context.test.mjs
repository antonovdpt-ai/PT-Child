import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync(new URL('../supabase/functions/ptchild-ai/index.ts',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function scrubClinicalText'),source.indexOf('Deno.serve'));
const build=new Function('MAX_PROMPT_CHARS','MAX_TRANSCRIPT_CHARS','PublicError',stripTypeScriptTypes(code)+';return buildServerPrompt;')(100000,12000,Error);
test('next plan context uses active goals, latest ordered sessions, tolerance, function and scrubbed assessment',async()=>{
 const calls=[];
 const rows={assessments:{observation:'Тест Имя: опора',conclusion:'Оценить помощь'},goals:[{id:'private-db-id',title:'Опора',status:'active'},{id:'closed',title:'Завершённая',status:'achieved'}],sessions:[{session_date:'2026-10-07',note:'Тест Имя: с помощью',tolerance:'low',dynamics_status:'improved',function_changes:'Меньше поддержки',planned_session:{internal:'not sent'}}]};
 const sb={from(table){const c={table,filters:[],order:[]};calls.push(c);const q={select(v){c.select=v;return q;},eq(k,v){c.filters.push([k,v]);return q;},order(k,v){c.order.push([k,v]);return q;},limit(v){c.limit=v;return q;},maybeSingle(){return q;},then(r){return Promise.resolve({data:rows[table],error:null}).then(r);}};return q;}};
 const {prompt}=await build(sb,{display_name:'Тест Имя',date_of_birth:'2020-01-01',sex:'male'},'child','next_session_plan',{});
 const context=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1));
 assert.equal(context.goals.length,1);assert.equal(context.goals[0].status,'active');assert.equal(context.sessions[0].tolerance,'low');assert.equal(context.sessions[0].dynamics_status,'improved');assert.equal(context.sessions[0].function_changes,'Меньше поддержки');assert.equal(context.sessions[0].planned_session,undefined);assert.ok(context.assessment.observation.includes('[имя удалено]'));assert.ok(!JSON.stringify(context).includes('private-db-id'));assert.ok(!JSON.stringify(context).includes('Тест Имя'));
 assert.ok(calls.every(c=>c.filters.some(([k,v])=>k==='patient_id'&&v==='child')));const sessions=calls.find(c=>c.table==='sessions');assert.equal(sessions.limit,3);assert.deepEqual(sessions.order.map(x=>x[0]),['session_date','created_at']);
 assert.ok(calls.find(c=>c.table==='goals').filters.some(([k,v])=>k==='status'&&v==='active'),'active goals filtered before row limit');assert.match(prompt,/исходное положение/);assert.match(prompt,/2–4/);assert.match(prompt,/insufficient_context/);
});

