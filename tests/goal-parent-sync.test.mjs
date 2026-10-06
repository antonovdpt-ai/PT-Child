import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createFullParentSchemaFixture} from './parent-full-schema-fixture.mjs';

// Execute current application SQL, not a mock of the proposed synchronizer.
// These regression tests deliberately stay RED until the goal fix is implemented.
const specialist='11111111-1111-4111-8111-111111111111';
const parent='22222222-2222-4222-8222-222222222222';
const child='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('ordinary clinical goal edits must keep an explicitly published parent goal in sync',async t=>{
 const {db,query}=await createFullParentSchemaFixture();
 const scalar=async(sql,args=[])=>Object.values((await query(sql,args))[0])[0];
 const as=async(user,fn)=>{
  await db.exec('set role authenticated');
  await query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  try{return await fn();}finally{await db.exec('reset role');}
 };
 const visible=()=>as(parent,()=>scalar('select parent_portal_goals($1)',[child]));
 try{
  await query('insert into auth.users(id,email) values($1,$2),($3,$4)',[specialist,'specialist@example.test',parent,'parent@example.test']);
  await query("insert into app_user_roles(user_id,role) values($1,'parent') on conflict do nothing",[parent]);
  await query("delete from app_user_roles where user_id=$1 and role='specialist'",[parent]);
  await query("insert into patients(id,therapist_id,display_name) values($1,$2,'FICTIONAL goal regression child')",[child,specialist]);
  await query('insert into parent_child_access(parent_user_id,patient_id,therapist_id) values($1,$2,$3)',[parent,child,specialist]);
  const [{id}]=await as(specialist,()=>query("insert into goals(patient_id,title,baseline,criterion,deadline,progress) values($1,'Open a door','Cannot open a door','Three attempts','2026-12-01',0) returning id",[child]));
  await t.test('private creation remains invisible and parent cannot SELECT clinical goals',async()=>{
   assert.deepEqual(await visible(),[]);
   assert.deepEqual(await as(parent,()=>query('select * from goals')),[]);
  });
  // Simulate the existing explicit publication operation, then edit through
  // the same clinical UPDATE used by the ordinary editor and session progress.
  const [{id:publicationId}]=await as(specialist,()=>query("insert into parent_goal_publications(goal_id,patient_id,therapist_id,title,status,published_at,updated_at) values($1,$2,$3,'Open a door','new',now(),'2020-01-01') returning id",[id,child,specialist]));
  assert.equal((await visible()).length,1);
  await db.exec(await readFile(new URL('../supabase/migrations/20261006_013_goal_parent_sync.sql',import.meta.url),'utf8'));
  await as(specialist,()=>query("update goals set title='Open a door with the right hand',criterion='Five attempts',deadline='2027-01-01',progress=60 where id=$1",[id]));
  await t.test('title, criterion, deadline and progress propagate from clinical UPDATE',async()=>{
   const [goal]=await visible();
   assert.equal(goal.title,'Open a door with the right hand');
   assert.equal(goal.criterion,'Five attempts');
   assert.equal(goal.deadline,'2027-01-01');
   assert.equal(goal.progress,60);
   assert.equal(goal.status,'in_progress');
  });
  await t.test('publication updated_at changes when clinical progress changes',async()=>{
   const value=await scalar('select updated_at from parent_goal_publications where id=$1',[publicationId]);
   assert.ok(new Date(value)>new Date('2020-01-01'));
  });
  await as(specialist,()=>query("update goals set status='achieved',progress=100 where id=$1",[id]));
  await t.test('clinical completion becomes achieved and 100 percent for the parent',async()=>{
   const [goal]=await visible();assert.equal(goal.status,'achieved');assert.equal(goal.progress,100);
  });
  await t.test('database rejects a second publication for the same clinical goal',async()=>{
   await assert.rejects(query("insert into parent_goal_publications(goal_id,patient_id,therapist_id,title,published_at) values($1,$2,$3,'Duplicate',now())",[id,child,specialist]),/unique|duplicate|already|publication/i);
  });
 }finally{await db.close();}
});
