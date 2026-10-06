import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createFullParentSchemaFixture} from './parent-full-schema-fixture.mjs';
const root=new URL('../supabase/',import.meta.url);
const migration=await readFile(new URL('migrations/20261006_013_goal_parent_sync.sql',root),'utf8');
const definitions=await readFile(new URL('verification/verify_goal_parent_sync_definitions.sql',root),'utf8');
const verification=(await readFile(new URL('verification/verify_goal_parent_sync.sql',root),'utf8')).replace(/^\\set.*$/m,'').replace(/^\\ir.*$/m,definitions);
test('013 aborts ambiguous duplicates without cleanup or partial schema changes',async()=>{
 const {db,query}=await createFullParentSchemaFixture();
 try{
  const A='11111111-1111-4111-8111-111111111111',C='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await query('insert into auth.users(id,email) values($1,$2)',[A,'synthetic@example.test']);
  await query("insert into patients(id,therapist_id,display_name) values($1,$2,'Synthetic')",[C,A]);
  const [{id}]=await query("insert into goals(patient_id,therapist_id,title) values($1,$2,'Same goal') returning id",[C,A]);
  for(let i=0;i<2;i++)await query("insert into parent_goal_publications(goal_id,patient_id,therapist_id,title) values($1,$2,$3,'Same goal')",[id,C,A]);
  await assert.rejects(db.exec(migration),/STOP: ambiguous duplicate/);
  await db.exec('rollback');
  assert.equal((await query('select count(*)::int n from parent_goal_publications'))[0].n,2);
  assert.equal((await query("select count(*)::int n from information_schema.columns where table_name='goals' and column_name='parent_visible'"))[0].n,0);
 }finally{await db.close();}
});
test('013 refuses a spoofed uniqueness index and verifier rejects security drift',async()=>{
 const {db,query}=await createFullParentSchemaFixture();
 try{
  await db.exec('create index parent_goal_publications_goal_unique on parent_goal_publications(goal_id)');
  await assert.rejects(db.exec(migration),/STOP: unexpected goal uniqueness/);
  await db.exec('rollback');
  await db.exec('drop index parent_goal_publications_goal_unique');
  await db.exec(migration);
  const rows=(await db.exec(verification)).flatMap(r=>r.rows||[]);
  assert.ok(rows.some(r=>r.result==='GOAL_PARENT_SYNC_VERIFIED'));
  assert.equal((await query("select current_setting('transaction_read_only') as v"))[0].v,'off');
  await db.exec('grant execute on function sync_goal_parent_projection() to authenticated');
  await assert.rejects(db.exec(verification),/STOP|drift|grant|definition/i);
  await db.exec('rollback');
  await db.exec('revoke execute on function sync_goal_parent_projection() from authenticated');
  await db.exec('alter table goals disable trigger sync_goal_parent_projection');
  await assert.rejects(db.exec(verification),/STOP: missing goal triggers/);
  await db.exec('rollback');
 }finally{await db.close();}
});
