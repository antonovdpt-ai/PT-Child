import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createParentDatabaseFixture} from './parent-database-fixture.mjs';
const migrationUrl=new URL('../supabase/migrations/20261003_011_parent_role_boundaries.sql',import.meta.url);
const verifierUrl=new URL('../supabase/verification/verify_migration.sql',import.meta.url);
test('011 authoritative roles deny own-source and Storage, provision trusted signups, and notify published goals',async t=>{
 const migration=process.env.PARENT011_BASELINE?'':await readFile(migrationUrl,'utf8');
 const h=await createParentDatabaseFixture(),{db,query,scalar,as,specialist,parentA,parentB,childA,childB}=h;
 try {
 const verification=(await readFile(verifierUrl,'utf8')).replace('\\set on_error_stop on','');
 const latest=verification.split('-- Parent publication withdrawal boundary (012).')[0];
 await assert.rejects(db.exec(latest),/Missing or unsafe specialist role intersection/);
 await query(`insert into auth.users(id,email) values('55555555-5555-4555-8555-555555555555','previous-unclassified@example.test')`);
 await db.exec(migration);
 assert.deepEqual(await as('authenticated','55555555-5555-4555-8555-555555555555',()=>query('select * from current_app_roles()')),[]);
 await t.test('parent own-prefix clinical insert and direct private Storage are denied while specialist/dual retain owner isolation',async()=>{
  for(const actor of [parentA,parentB]) {
   await assert.rejects(as('authenticated',actor,()=>query('insert into patients(id,therapist_id,display_name) values(gen_random_uuid(),$1,\'private\')',[actor])),/row.level security/i);
   for(const bucket of ['patient-media','specialist-logos'])await assert.rejects(as('authenticated',actor,()=>query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,`${actor}/own.jpg`])),/row.level security/i);
  }
  await query('insert into patients(id,therapist_id,display_name) values($1,$2,\'parent owned hidden\')',['cccccccc-cccc-4ccc-8ccc-cccccccccccc',parentA]);
  await query('insert into sessions(patient_id,therapist_id,note) values($1,$2,\'internal\')',['cccccccc-cccc-4ccc-8ccc-cccccccccccc',parentA]);
  await query('insert into storage.objects(bucket_id,name) values(\'patient-media\',$1)',[`${parentA}/seed.jpg`]);
  assert.deepEqual(await as('authenticated',parentA,()=>query('select * from sessions')),[]);
  assert.deepEqual(await as('authenticated',parentA,()=>query('select * from patients')),[]);
  assert.deepEqual(await as('authenticated',parentA,()=>query('select * from storage.objects')),[]);
  assert.equal((await as('authenticated',parentA,()=>query('update storage.objects set version=\'x\' returning id'))).length,0);
  assert.equal((await as('authenticated',parentA,()=>query('delete from storage.objects returning id'))).length,0);
  await query('insert into app_user_roles(user_id,role) values($1,\'specialist\')',[parentB]);
  for(const actor of [specialist,parentB]) {
   const ownId=actor===specialist?'dddddddd-dddd-4ddd-8ddd-dddddddddddd':'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
   await as('authenticated',actor,()=>query('insert into patients(id,therapist_id) values($1,$2)',[ownId,actor]));
   await as('authenticated',actor,()=>query('insert into storage.objects(bucket_id,name) values(\'patient-media\',$1)',[`${actor}/own.jpg`]));
   assert.ok((await as('authenticated',actor,()=>query('select * from patients'))).every(row=>row.therapist_id===actor));
   assert.ok((await as('authenticated',actor,()=>query('select * from storage.objects'))).every(row=>row.name.startsWith(`${actor}/`)));
   await query('insert into account_deletion_jobs values($1)',[actor]);
   assert.deepEqual(await as('authenticated',actor,()=>query('select * from patients')),[]);
   assert.deepEqual(await as('authenticated',actor,()=>query('select * from storage.objects')),[]);
   await query('delete from account_deletion_jobs where user_id=$1',[actor]);
  }
 });
 await t.test('ordinary email signup gets specialist; reservations/invited/anonymous/nonemail and metadata claims fail closed with no replay promotion',async()=>{
  const fresh='99999999-9999-4999-8999-999999999999',invited='88888888-8888-4888-8888-888888888888',reserved='77777777-7777-4777-8777-777777777777',anonymous='66666666-6666-4666-8666-666666666666';
  await query('insert into auth.users(id,email,raw_user_meta_data) values($1,\'ordinary@example.test\',\'{"role":"parent"}\')',[fresh]);
  assert.deepEqual(await as('authenticated',fresh,()=>query('select * from current_app_roles()')),[{role:'specialist'}]);
  const [{id:ordinaryContact}]=await query(`insert into patient_contacts(id,patient_id,therapist_id,full_name,email) values(gen_random_uuid(),$1,$2,'Ordinary first','ordinary@example.test') returning id`,[childA,specialist]);
  await as('service_role',null,()=>query(`select * from issue_parent_invitation_record($1,$2,$3,$4,'new')`,[specialist,childA,ordinaryContact,'b'.repeat(64)]));
  assert.deepEqual(await as('authenticated',fresh,()=>query('select * from current_app_roles()')),[{role:'specialist'}]);
  const [{id:contact}]=await query('insert into patient_contacts(id,patient_id,therapist_id,full_name,email) values(gen_random_uuid(),$1,$2,\'Family\',\'reserved@example.test\') returning id',[childA,specialist]);
  await as('service_role',null,()=>query('select * from issue_parent_invitation_record($1,$2,$3,$4,\'new\')',[specialist,childA,contact,'a'.repeat(64)]));
  await query(`update parent_invitations set created_at=now()-interval '8 days',expires_at=now()-interval '1 day',revoked_at=now() where contact_id=$1`,[contact]);
  await query('insert into auth.users(id,email,raw_user_meta_data) values($1,\'RESERVED@example.test\',\'{"role":"specialist"}\')',[reserved]);
  await query('insert into auth.users(id,email,invited_at) values($1,\'invited@example.test\',now())',[invited]);
  await query('insert into auth.users(id,email,is_anonymous) values($1,\'anonymous@example.test\',true)',[anonymous]);
  const [{id:nonemail}]=await query('insert into auth.users(id) values(gen_random_uuid()) returning id');
  assert.deepEqual(await as('authenticated',nonemail,()=>query('select * from current_app_roles()')),[]);
  for(const actor of [reserved,invited,anonymous])assert.deepEqual(await as('authenticated',actor,()=>query('select * from current_app_roles()')),[]);
  await query('update auth.users set invited_at=null,raw_user_meta_data=\'{"role":"specialist"}\' where id=$1',[invited]);
  await db.exec(migration);
  for(const actor of [reserved,invited,anonymous])assert.deepEqual(await as('authenticated',actor,()=>query('select * from current_app_roles()')),[]);
  assert.deepEqual(await as('authenticated',parentA,()=>query('select * from current_app_roles()')),[{role:'parent'}]);
  await assert.rejects(as('authenticated',parentA,()=>query('select * from parent_signup_reservations')),/permission denied/i);
 });
 await t.test('actual post011 reservation then Auth creation and invitation acceptance creates exactly parent, never specialist',async()=>{
  const actor='44444444-4444-4444-8444-444444444444',token='secure-parent-token-'.repeat(3),digest=createHash('sha256').update(token).digest('hex');
  const [{id:contact}]=await query(`insert into patient_contacts(id,patient_id,therapist_id,full_name,email) values(gen_random_uuid(),$1,$2,'Parent acceptance','post011-parent@example.test') returning id`,[childB,specialist]);
  await as('service_role',null,()=>query(`select * from issue_parent_invitation_record($1,$2,$3,$4,'new')`,[specialist,childB,contact,digest]));
  await query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'post011-parent@example.test','{"role":"specialist"}')`,[actor]);
  assert.deepEqual(await as('authenticated',actor,()=>query('select * from current_app_roles()')),[]);
  const documents=['terms','privacy','personal_data_consent'].map(document_type=>({document_type,accepted:true}));
  await as('authenticated',actor,()=>query('select accept_parent_invitation($1,$2)',[token,JSON.stringify(documents)]));
  assert.deepEqual(await as('authenticated',actor,()=>query('select * from current_app_roles()')),[{role:'parent'}]);
  assert.equal((await as('authenticated',actor,()=>scalar('select parent_portal_children()')))[0].id,childB);
  await assert.rejects(as('authenticated',actor,()=>query(`insert into patients(id,therapist_id) values(gen_random_uuid(),$1)`,[actor])),/row.level security/i);
 });
 await t.test('goal publication/material changes notify only eligible parents with safe copy and no private or timestamp-only events',async()=>{
  const [{id:goal}]=await query('insert into goals(patient_id,therapist_id,title) values($1,$2,\'PRIVATE GOAL\') returning id',[childA,specialist]);
  const [{id:publication}]=await query('insert into parent_goal_publications(goal_id,patient_id,therapist_id,title) values($1,$2,$3,\'safe\') returning id',[goal,childA,specialist]);
  const count=()=>scalar('select count(*)::int from parent_notifications where entity_id=$1',[publication]);
  assert.equal(await count(),0);
  await query('update parent_goal_publications set published_at=now() where id=$1',[publication]);assert.equal(await count(),1);
  await query('update parent_goal_publications set updated_at=now(),published_at=now() where id=$1',[publication]);assert.equal(await count(),1);
  await query('update parent_goal_publications set title=\'safe2\',status=\'in_progress\' where id=$1',[publication]);assert.equal(await count(),2);
  await query('update parent_goal_publications set unpublished_at=now(),description=\'PRIVATE DRAFT\' where id=$1',[publication]);assert.equal(await count(),2);
  await query('update parent_goal_publications set unpublished_at=null where id=$1',[publication]);assert.equal(await count(),3);
  for(const field of ['revoked','inactive']) {
   if(field==='revoked')await query('update parent_child_access set status=\'revoked\',revoked_at=now() where parent_user_id=$1',[parentA]);
   else {await query(`update parent_child_access set status='active',revoked_at=null where parent_user_id=$1`,[parentA]);await query('insert into account_deletion_jobs values($1)',[parentA]);}
   await query('update parent_goal_publications set title=title||\'x\' where id=$1',[publication]);assert.equal(await count(),3);
  }
  await query('delete from account_deletion_jobs where user_id=$1',[parentA]);await query('insert into account_deletion_jobs values($1)',[specialist]);await query(`update parent_goal_publications set title=title||'z' where id=$1`,[publication]);assert.equal(await count(),3);await query('delete from account_deletion_jobs where user_id=$1',[specialist]);
  const notifications=await query('select * from parent_notifications where entity_id=$1',[publication]);assert.ok(notifications.every(row=>row.parent_user_id===parentA&&row.type==='goal_published'&&row.entity_type==='goal'));assert.doesNotMatch(JSON.stringify(notifications),/PRIVATE|safe2/);
 });
 await t.test('latest verifier rejects pre011, passes post011/replay and catches unsafe policies, provisioning and goal triggers',async()=>{
  const verification=(await readFile(verifierUrl,'utf8')).replace('\\set on_error_stop on','');
  const latest=verification.split('-- Parent publication withdrawal boundary (012).')[0];
  await db.exec(latest);
  for(const mutation of ["alter table parent_notifications drop constraint parent_notifications_type_check;alter table parent_notifications add constraint parent_notifications_type_check check(type in ('report_published','appointment_created','appointment_changed','goal_published') or true)",'drop policy specialist_role_required on patients','alter policy specialist_role_required on patients using(true)','alter policy specialist_role_required on storage.objects with check(true)','alter table auth.users disable trigger provision_ordinary_specialist','alter table parent_goal_publications disable trigger notify_parent_goal_publication','grant insert on parent_signup_reservations to authenticated','create policy parent_unsafe_source on sessions for select to authenticated using(true)','create policy parent_unsafe_storage on storage.objects for select to authenticated using(true)']) {
   await db.exec('begin');try{await db.exec(mutation);await assert.rejects(db.exec(latest));}finally{await db.exec('rollback');}
  }
  await db.exec(migration);await db.exec(latest);
 });
 }finally{await db.close();}
});
