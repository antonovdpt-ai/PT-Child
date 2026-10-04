import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createParentDatabaseFixture} from './parent-database-fixture.mjs';
const load=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
test('012 own active specialist withdrawal preserves immutable artifacts and parent invisibility',async t=>{
 const h=await createParentDatabaseFixture(),{db,query,scalar,as,specialist,parentA,parentB,childA}=h;
 try {
 await db.exec(await load('20261003_011_parent_role_boundaries.sql'));
 const migration=process.env.PARENT012_BASELINE?'':await load('20261003_012_parent_publication_archive.sql');
 const verify=(await readFile(new URL('../supabase/verification/verify_migration.sql',import.meta.url),'utf8')).replace('\\set on_error_stop on','');
 const block=verify.slice(verify.indexOf('-- Parent publication withdrawal boundary (012).'));
 if(!process.env.PARENT012_BASELINE) await assert.rejects(db.exec(block),/Unsafe publication withdrawal guard/);
 await db.exec(migration);
 await query(`insert into app_user_roles(user_id,role) values($1,'specialist')`,[parentB]);
 for(const table of ['parent_reports','parent_session_reports']) {
 const [{id}]=await query(`insert into ${table}(patient_id,therapist_id) values($1,$2) returning id`,[childA,specialist]);
 const pdf=`${specialist}/parent-reports/test/${id}.pdf`;
 const photo='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
 if(table==='parent_session_reports') await query(`update ${table} set published_media=$2 where id=$1`,[id,JSON.stringify([{id:photo,storage_path:pdf+'.jpg',sha256:'b'.repeat(64),content_type:'image/jpeg'}])]);
 await query(`update ${table} set publication_status='published',published_at=now(),published_by=$2,published_snapshot='{}',pdf_generated_at=now(),pdf_storage_path=$3,pdf_sha256=$4 where id=$1`,[id,specialist,pdf,'a'.repeat(64)]);
 await query(`insert into storage.objects(bucket_id,name) values('patient-media',$1)`,[pdf]);
 const before=await query(`select * from ${table} where id=$1`,[id]);
 await t.test(table+' RLS denies parent/foreign/inactive and mutable archival',async()=>{
  for(const actor of [parentA,parentB])assert.equal((await as('authenticated',actor,()=>query(`update ${table} set publication_status='archived' where id=$1 returning id`,[id]))).length,0);
  await query('insert into account_deletion_jobs values($1)',[specialist]);
  assert.equal((await as('authenticated',specialist,()=>query(`update ${table} set publication_status='archived' where id=$1 returning id`,[id]))).length,0);
  await query('delete from account_deletion_jobs where user_id=$1',[specialist]);
  for(const mutation of ["published_snapshot='{\"changed\":true}'",`pdf_storage_path='${specialist}/parent-reports/evil.pdf'`,`therapist_id='${parentB}'`,'publication_revision=publication_revision+1',table==='parent_reports'?"complaint='changed'":"what_did='changed'"])
   await assert.rejects(as('authenticated',specialist,()=>query(`update ${table} set publication_status='archived',${mutation} where id=$1`,[id])),/immutable|ownership mismatch/i);
  await assert.rejects(as('authenticated',specialist,()=>query(`update ${table} set publication_status='draft' where id=$1`,[id])),/immutable|ownership mismatch/i);
 });
 await t.test(table+' own archive succeeds once and remains invisible/immutable',async()=>{
  const visible=await as('authenticated',parentA,()=>scalar('select parent_portal_report($1)',[id]));assert.ok(visible.report);
  assert.ok(await as('service_role',null,()=>scalar("select resolve_parent_publication_file($1,$2,'pdf',null)",[parentA,id])));
  if(table==='parent_session_reports') assert.ok(await as('service_role',null,()=>scalar("select resolve_parent_publication_file($1,$2,'photo',$3)",[parentA,id,photo])));

  assert.equal((await as('authenticated',specialist,()=>query(`update ${table} set publication_status='archived' where id=$1 returning id`,[id]))).length,1);
  const after=await query(`select * from ${table} where id=$1`,[id]);assert.deepEqual({...after[0],publication_status:'published'},before[0]);
  assert.deepEqual(await as('authenticated',parentA,()=>scalar('select parent_portal_report($1)',[id])),{report:null});
  assert.equal(await as('service_role',null,()=>scalar("select resolve_parent_publication_file($1,$2,'pdf',null)",[parentA,id])),null);
  assert.ok(!(await as('authenticated',parentA,()=>scalar('select parent_portal_reports($1)',[childA]))).some(r=>r.id===id));
  if(table==='parent_session_reports') assert.equal(await as('service_role',null,()=>scalar("select resolve_parent_publication_file($1,$2,'photo',$3)",[parentA,id,photo])),null);
  await assert.rejects(as('authenticated',specialist,()=>query(`update ${table} set publication_status='published' where id=$1`,[id])),/immutable|ownership mismatch/i);
  await assert.rejects(as('authenticated',specialist,()=>query(`delete from ${table} where id=$1`,[id])),/immutable|ownership mismatch/i);
 });
 }
 await t.test('012 replay and full verifier retain exact guard and detect weakened body',async()=>{
  await db.exec(verify);await db.exec(migration);await db.exec(verify);
  await db.exec('begin');try {await db.exec("create or replace function guard_parent_report_publication() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin return new;end$$");await assert.rejects(db.exec(block),/Unsafe publication withdrawal guard/);}finally{await db.exec('rollback');}
 });
 }finally{await db.close();}
});
