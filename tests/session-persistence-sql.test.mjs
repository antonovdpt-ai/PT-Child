import test from 'node:test';
import assert from 'node:assert/strict';
import {createFullParentSchemaFixture} from './parent-full-schema-fixture.mjs';
import {validPlan} from './session-flow-fixture.mjs';
test('existing JSONB schema retains plans and snapshots, compares versions and denies parent clinical access',async()=>{
 const {db,query}=await createFullParentSchemaFixture();
 const specialist='11111111-1111-4111-8111-111111111111',parent='22222222-2222-4222-8222-222222222222',child='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444';
 const as=async(id,fn)=>{await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`);try{return await fn();}finally{await db.exec('reset role');}};
 try{
  await query('insert into auth.users(id,email) values($1,\'specialist@example.test\'),($2,\'parent@example.test\')',[specialist,parent]);
  await query('delete from app_user_roles where user_id=$1',[parent]);await query("insert into app_user_roles(user_id,role) values($1,'parent')",[parent]);
  await as(specialist,()=>query("insert into patients(id,therapist_id,display_name) values($1,$2,'Fictional'),($3,$2,'Other fictional')",[child,specialist,other]));
  const accepted={...validPlan,saved_at:'2026-10-07T00:00:00Z'};
  await as(specialist,()=>query('update patients set next_session_plan=$1 where id=$2 and therapist_id=$3',[JSON.stringify(accepted),child,specialist]));
  assert.deepEqual((await as(specialist,()=>query('select next_session_plan from patients where id=$1',[child])))[0].next_session_plan,accepted);
  assert.equal((await query('select next_session_plan from patients where id=$1',[other]))[0].next_session_plan,null);
  await as(specialist,()=>query("insert into sessions(patient_id,note,planned_session) values($1,'Факт',$2)",[child,JSON.stringify(accepted)]));
  const newer={...accepted,main_task:'Обновлённая задача'};
  await as(specialist,()=>query('update patients set next_session_plan=$1 where id=$2',[JSON.stringify(newer),child]));
  assert.equal((await as(specialist,()=>query('update patients set next_session_plan=null where id=$1 and next_session_plan=$2::jsonb returning id',[child,JSON.stringify(accepted)]))).length,0);
  assert.deepEqual((await query('select planned_session from sessions where patient_id=$1',[child]))[0].planned_session,accepted);
  for(const table of ['patients','sessions'])assert.deepEqual(await as(parent,()=>query(`select * from ${table}`)),[]);
  assert.equal((await query('select count(*)::int as n from parent_session_reports'))[0].n,0,'clinical save does not publish an internal plan');
 }finally{await db.close();}
});

