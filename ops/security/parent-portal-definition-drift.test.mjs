import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createFullParentSchemaFixture,currentParentMigrations} from '../../tests/parent-full-schema-fixture.mjs';
const verification=new URL('../../supabase/verification/',import.meta.url);
async function load(name='verify_parent_portal.sql') {
 let sql=await readFile(new URL(name,verification),'utf8');
 for(const match of [...sql.matchAll(/^\\ir (\S+)\s*$/gm)]){
  const included=await load(match[1]);
  sql=sql.replace(match[0],()=>included);
 }
 return sql.replace(/^\\set[^\n]*\n/gm,'');
}
async function fixture() {
 const h=await createFullParentSchemaFixture({migrations:currentParentMigrations});
 try {
  const specialist='11111111-1111-4111-8111-111111111111',parentA='22222222-2222-4222-8222-222222222222',parentB='33333333-3333-4333-8333-333333333333';
  const childA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',childB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await h.query('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)',[specialist,'specialist@example.test',parentA,'parent-a@example.test',parentB,'parent-b@example.test']);
  await h.query('delete from app_user_roles where user_id in ($1,$2)',[parentA,parentB]);
  await h.query("insert into app_user_roles(user_id,role) values($1,'parent'),($2,'parent')",[parentA,parentB]);
  await h.query('insert into patients(id,therapist_id,display_name,date_of_birth) values($1,$2,$3,$4),($5,$2,$6,$7)',[childA,specialist,'Fictional A','2020-01-01',childB,'Fictional B','2021-01-01']);
  await h.query('insert into parent_child_access(parent_user_id,patient_id,therapist_id) values($1,$2,$3),($4,$5,$3)',[parentA,childA,specialist,parentB,childB]);
  const scalar=async(sql,args=[])=>Object.values((await h.query(sql,args))[0])[0];
  const as=async(role,user,fn)=>{
   await h.db.exec('reset role;set role '+role);
   await h.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);
   try{return await fn();}finally{await h.db.exec('reset role');}
  };
  return {...h,scalar,as,specialist,parentA,parentB,childA,childB};
 }catch(error){await h.db.close();throw error;}
}
async function rejectsFull(h,sql,mutation,label,verifyMutation) {
 await h.db.exec('begin');
 try {
  await h.db.exec(mutation);
  if(verifyMutation)await verifyMutation();
  // Keep the real BEGIN READ ONLY and ROLLBACK entrypoint: a nested BEGIN
  // retains the fixture transaction; SET makes catalog assertions read-only.
  await h.db.exec('set transaction read only');
  await assert.rejects(h.db.exec(sql),/STOP:|Unsafe|Missing|Unexpected|forbidden|unsafe|Clinical source policy/,label);
 } finally {await h.db.exec('rollback');}
}
test('full read-only release verifier rejects projection child-filter removal and private source return with intact grants/attributes',async()=>{
 const h=await fixture();try {
 const sql=await load();await h.db.exec(sql);
 await h.query('insert into goals(patient_id,therapist_id,title,progress) values($1,$2,$3,17)',[h.childB,h.specialist,'PRIVATE OTHER CHILD SOURCE']);
 const metadata=()=>h.query("select prosecdef,provolatile,proconfig,proacl::text from pg_proc where oid='public.parent_portal_goals(uuid)'::regprocedure");
 const before=await metadata();
 await rejectsFull(h,sql,`create or replace function public.parent_portal_goals(p_patient_id uuid)
 returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
 begin return coalesce((select jsonb_agg(to_jsonb(g)) from public.goals g),'[]'::jsonb);end; $$;`,'unsafe raw cross-child projection',async()=>{
  assert.deepEqual(await metadata(),before,'grants/search_path/security/stability preserved');
  const leaked=await h.as('authenticated',h.parentA,()=>h.scalar('select parent_portal_goals($1)',[h.childA]));
  assert.equal(leaked[0].patient_id,h.childB);
  assert.equal(leaked[0].title,'PRIVATE OTHER CHILD SOURCE');
  assert.equal(leaked[0].progress,17,'raw source field outside publication projection');
 });
 }finally{await h.db.close();}
});
test('full release verifier detects unknown body drift for every reviewed parent security function',async(t)=>{
 const h=await fixture();try {
 const sql=await load();await h.db.exec(sql);
 const rows=await h.query(`select oid::regprocedure::text signature,pg_get_functiondef(oid) definition from pg_proc
 where pronamespace='public'::regnamespace and (proname like '%parent%' or proname in ('current_app_roles','specialist_source_access','specialist_storage_access','provision_ordinary_specialist','account_is_active')) order by proname`);
 assert.ok(rows.length>=32,'entire identity/projection/internal/service boundary');
 t.diagnostic(`complete body mutations=${rows.length}`);
 for(const r of rows)await rejectsFull(h,sql,r.definition.replace('AS $function$', 'AS $function$/* unreviewed body drift */'),r.signature);
 }finally{await h.db.close();}
});
test('full release verifier rejects broad OR in every publication USING and WITH CHECK expression',async(t)=>{
 const h=await fixture();try {
 const sql=await load();await h.db.exec(sql);
 const policies=await h.query(`select * from pg_policies where schemaname='public' and tablename in ('parent_reports','parent_session_reports','parent_session_report_media','parent_goal_publications','parent_notifications') order by tablename,policyname`);
 t.diagnostic(`publication policies=${policies.length}; expression mutations=${policies.reduce((n,p)=>n+Number(Boolean(p.qual))+Number(Boolean(p.with_check)),0)}`);
 for(const p of policies)for(const [field,clause]of [['qual','using'],['with_check','with check']])if(p[field])await rejectsFull(h,sql,`alter policy "${p.policyname}" on public.${p.tablename} ${clause} ((${p[field]}) OR true)`,`${p.tablename}.${p.policyname} ${clause}`);
 }finally{await h.db.close();}
});
test('full release verifier rejects policy set, roles, command and permissiveness drift',async()=>{
 const h=await fixture();try {
 const sql=await load();await h.db.exec(sql);
 for(const mutation of [
 'create policy extra_permissive on parent_session_reports for select to authenticated using(true)',
 'drop policy specialist_own on parent_session_reports',
 'alter policy specialist_own on parent_session_reports to public',
 `drop policy specialist_own on parent_session_reports;create policy specialist_own on parent_session_reports for select to authenticated using(therapist_id=auth.uid())`,
 `drop policy account_must_be_active on parent_session_reports;create policy account_must_be_active on parent_session_reports for all to authenticated using(account_is_active()) with check(account_is_active())`
 ])await rejectsFull(h,sql,mutation,mutation);
 }finally{await h.db.close();}
});


test('full release verifier rejects unreviewed function attributes, named owner, extra grants and overloads',async()=>{
 const h=await fixture();try {
 const sql=await load();await h.db.exec(sql);
 for(const mutation of [
 'alter function parent_portal_goals(uuid) volatile',
 'create role unreviewed_owner;alter function parent_portal_goals(uuid) owner to unreviewed_owner',
 'create role unreviewed_executor;grant execute on function parent_portal_goals(uuid) to unreviewed_executor',
 `create function public.parent_portal_goals(text) returns jsonb language sql security definer set search_path=pg_catalog,public as $$select '[]'::jsonb$$`
 ])await rejectsFull(h,sql,mutation,mutation);
 }finally{await h.db.close();}
});

test('reviewed repo-source reference regenerates deterministically and full schema verifies in READ ONLY without changes',async()=>{
 const {generateReference}=await import('./generate-parent-portal-definition-reference.mjs');
 const committed=await readFile(new URL('verify_parent_portal_definitions.sql',verification),'utf8');
 assert.equal(await generateReference(),committed,'checked-in assertion derives from repo sources');
 assert.equal(await generateReference(),committed,'no random fixture UUID/OID/user data in reference');
 const h=await createFullParentSchemaFixture({migrations:currentParentMigrations});try {
 const sql=await load();
 const before=await h.query('select * from patients order by id');
 await h.db.exec(sql.replace(/rollback;\s*$/i,()=>`do $$ begin if current_setting('transaction_read_only') <> 'on' then raise exception 'Verifier is not READ ONLY'; end if; end; $$;rollback;`));
 assert.deepEqual(await h.query('select * from patients order by id'),before);
 }finally{await h.db.close();}
});
