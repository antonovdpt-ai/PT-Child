import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createFullParentSchemaFixture} from './parent-full-schema-fixture.mjs';
const migrationUrl=new URL('../supabase/migrations/20261006_013_goal_parent_sync.sql',import.meta.url);
const A='11111111-1111-4111-8111-111111111111',B='33333333-3333-4333-8333-333333333333';
const P='22222222-2222-4222-8222-222222222222',Q='44444444-4444-4444-8444-444444444444';
const C='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',D='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
test('013 actual SQL provides atomic goal visibility lifecycle and real-role isolation',async t=>{
 const migration=await readFile(migrationUrl,'utf8');
 const {db,query}=await createFullParentSchemaFixture();
 const scalar=async(sql,args=[])=>Object.values((await query(sql,args))[0])[0];
 const as=async(user,fn)=>{await db.exec('set role authenticated');await query("select set_config('request.jwt.claim.sub',$1,false)",[user]);try{return await fn();}finally{await db.exec('reset role');}};
 const goals=user=>as(user,()=>scalar('select parent_portal_goals($1)',[C]));
 const edit=(id,sql,args=[])=>as(A,()=>query(`update goals set ${sql} where id=$1 returning *`,[id,...args]));
 try{
  for(const [id,email] of [[A,'a'],[B,'b'],[P,'p'],[Q,'q']])await query('insert into auth.users(id,email) values($1,$2)',[id,email+'@example.test']);
  for(const id of [P,Q]){await query("delete from app_user_roles where user_id=$1",[id]);await query("insert into app_user_roles(user_id,role) values($1,'parent')",[id]);}
  await query("insert into patients(id,therapist_id,display_name) values($1,$2,'Synthetic A'),($3,$4,'Synthetic B')",[C,A,D,B]);
  await query('insert into parent_child_access(parent_user_id,patient_id,therapist_id) values($1,$2,$3),($4,$5,$6)',[P,C,A,Q,D,B]);
  const [{id:legacy}]=await as(A,()=>query("insert into goals(patient_id,title,progress) values($1,'Legacy goal',0) returning id",[C]));
  await as(A,()=>query("insert into parent_goal_publications(goal_id,patient_id,therapist_id,title,description,published_at) values($1,$2,$3,'Legacy goal','Preserved safe wording',now())",[legacy,C,A]));
  await db.exec(migration);await db.exec(migration);
  await t.test('idempotent migration preserves existing publication text/visibility without automatic disclosure',async()=>{
   assert.equal(await scalar('select parent_visible from goals where id=$1',[legacy]),true);
   assert.equal((await goals(P))[0].description,'Preserved safe wording');
   assert.equal(await scalar('select parent_note from goals where id=$1',[legacy]),'Preserved safe wording');
  });
  let privateId,publishedId,pubId;
  await t.test('private creation and edit do not publish; explicit creation publishes complete allowlist',async()=>{
   [{id:privateId}]=await as(A,()=>query("insert into goals(patient_id,title) values($1,'Private secret') returning id",[C]));
   await edit(privateId,"title='Private changed',progress=60");
   assert.equal(await scalar('select count(*)::int from parent_goal_publications where goal_id=$1',[privateId]),0);
   [{id:publishedId}]=await as(A,()=>query("insert into goals(patient_id,title,baseline,criterion,deadline,progress,parent_visible) values($1,'Open a door','Cannot open','Three attempts','2026-12-01',20,true) returning id",[C]));
   [{id:pubId}]=await query('select id from parent_goal_publications where goal_id=$1',[publishedId]);
   const g=(await goals(P)).find(g=>g.title==='Open a door');
   assert.equal(g.baseline,'Cannot open');assert.equal(g.criterion,'Three attempts');assert.equal(g.deadline,'2026-12-01');assert.equal(g.progress,20);assert.equal(g.status,'in_progress');
   assert.deepEqual(Object.keys(g).sort(),['title','description','baseline','criterion','deadline','progress','status','updated_at'].sort());
   const dash=await as(P,()=>scalar('select parent_portal_dashboard($1)',[C]));assert.deepEqual(dash.goals,await goals(P));
  });
  await t.test('edits and session-style progress synchronize one row with advancing timestamp',async()=>{
   const before=await scalar('select updated_at from parent_goal_publications where id=$1',[pubId]);
   await edit(publishedId,"title='Right hand',criterion='Five attempts',deadline='2027-01-01',progress=60");
   await edit(publishedId,'progress=80');
   const g=(await goals(P)).find(g=>g.title==='Right hand');assert.equal(g.criterion,'Five attempts');assert.equal(g.deadline,'2027-01-01');assert.equal(g.progress,80);
   assert.ok(new Date(g.updated_at)>new Date(before));assert.equal(await scalar('select count(*)::int from parent_goal_publications where goal_id=$1',[publishedId]),1);
   assert.equal(await scalar('select id from parent_goal_publications where goal_id=$1',[publishedId]),pubId);
   await assert.rejects(query('insert into parent_goal_publications(goal_id,patient_id,therapist_id,title) values($1,$2,$3,$4)',[publishedId,C,A,'Duplicate']),/unique|duplicate/i);
  });
  await t.test('unpublish preserves clinical goal and session progress cannot republish; republish reuses row',async()=>{
   await edit(publishedId,'parent_visible=false');await edit(publishedId,'progress=40');
   assert.ok(!(await goals(P)).some(g=>g.title==='Right hand'));assert.equal(await scalar('select count(*)::int from goals where id=$1',[publishedId]),1);
   await edit(publishedId,'parent_visible=true');assert.equal((await goals(P)).find(g=>g.title==='Right hand').progress,40);
   assert.equal(await scalar('select id from parent_goal_publications where goal_id=$1',[publishedId]),pubId);
  });
  await t.test('completion and 100 percent deterministically agree; paused/cancelled stay explicit',async()=>{
   await edit(publishedId,"status='achieved'");const g=(await goals(P)).find(g=>g.title==='Right hand');assert.equal(g.progress,100);assert.equal(g.status,'achieved');
   await edit(privateId,'progress=100');assert.equal(await scalar('select status from goals where id=$1',[privateId]),'achieved');
   await edit(legacy,"status='paused'");assert.equal((await goals(P)).find(g=>g.title==='Legacy goal').status,'paused');
   await edit(legacy,"status='cancelled'");assert.equal((await goals(P)).find(g=>g.title==='Legacy goal').status,'cancelled');
   assert.equal((await goals(P)).find(g=>g.title==='Legacy goal').description,'Preserved safe wording');
   await edit(legacy,"parent_note='Updated parent-safe note'");assert.equal((await goals(P)).find(g=>g.title==='Legacy goal').description,'Updated parent-safe note');
  });
  await t.test('parents have no clinical SELECT; other child/specialist and independent publication writes denied',async()=>{
   assert.deepEqual(await goals(Q),[]);assert.deepEqual(await as(P,()=>query('select * from goals')),[]);
   assert.deepEqual(await as(B,()=>query('update goals set parent_visible=false where id=$1 returning id',[publishedId])),[]);
   for(const user of [A,B,P])await assert.rejects(as(user,()=>query("update parent_goal_publications set title='Injected' where id=$1",[pubId])),/permission denied/i);
  });
  await t.test('revoke and account-deletion guards deny parent results without breaking specialist goal',async()=>{
   await query("update parent_child_access set status='revoked',revoked_at=now() where parent_user_id=$1",[P]);assert.deepEqual(await goals(P),[]);
   await query("update parent_child_access set status='active',revoked_at=null where parent_user_id=$1",[P]);
   for(const user of [A,P]){await query("insert into account_deletion_jobs(user_id,status) values($1,'pending')",[user]);assert.deepEqual(await goals(P),[]);await query('delete from account_deletion_jobs where user_id=$1',[user]);}
   assert.equal((await as(A,()=>query('select id from goals where id=$1',[publishedId]))).length,1);
  });
  await t.test('deleting a clinical goal safely removes its publication',async()=>{
   await as(A,()=>query('delete from goals where id=$1',[publishedId]));assert.equal(await scalar('select count(*)::int from parent_goal_publications where id=$1',[pubId]),0);
   assert.ok(!(await goals(P)).some(g=>g.title==='Right hand'));
  });
  await t.test('projection failure rolls back clinical change in the same transaction',async()=>{
   await edit(legacy,'parent_visible=true');
   const before=await scalar('select title from goals where id=$1',[legacy]);
   await assert.rejects(edit(legacy,'title=$2',['X'.repeat(501)]),/check constraint|title_check/i);
   assert.equal(await scalar('select title from goals where id=$1',[legacy]),before);
   assert.equal((await goals(P)).find(g=>g.title===before).title,before);
  });
  await t.test('stale editor timestamp cannot overwrite a newer visibility decision',async()=>{
   const before=await scalar('select updated_at from goals where id=$1',[legacy]);
   await edit(legacy,'parent_visible=false');
   const newer=await scalar('select updated_at from goals where id=$1',[legacy]);
   assert.ok(new Date(newer)>new Date(before));
   assert.deepEqual(await as(A,()=>query('update goals set parent_visible=true where id=$1 and updated_at=$2 returning id',[legacy,before])),[]);
   assert.equal(await scalar('select parent_visible from goals where id=$1',[legacy]),false);
  });
 }finally{await db.close();}
});
