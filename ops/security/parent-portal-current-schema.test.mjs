import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createFullParentSchemaFixture} from '../../tests/parent-full-schema-fixture.mjs';

const root=new URL('../../supabase/',import.meta.url);
const goalMigration=await readFile(new URL('migrations/20261006_013_goal_parent_sync.sql',root),'utf8');
async function load(name) {
 let sql=await readFile(new URL('verification/'+name,root),'utf8');
 assert.doesNotMatch(sql,/^\\ir /m,'leaf assertions must not leave unresolved includes');
 return sql.replace(/^\\set[^\n]*\n/gm,'');
}
async function expanded(name) {
 let sql=await readFile(new URL('verification/'+name,root),'utf8');
 for(const match of [...sql.matchAll(/^\\ir (\S+)\s*$/gm)])sql=sql.replace(match[0],()=>included.get(match[1]));
 return sql.replace(/^\\set[^\n]*\n/gm,'');
}
const included=new Map();
for(const name of ['verify_migration.sql','verify_parent_portal_definitions.sql','verify_goal_parent_sync_definitions.sql'])included.set(name,await load(name));
const entrypoints=['verify_parent_portal.sql','verify_goal_parent_sync.sql'];
const checks=await Promise.all(entrypoints.map(expanded));
async function currentFixture() {
 const h=await createFullParentSchemaFixture();
 try {await h.db.exec(goalMigration);return h;}catch(error){await h.db.close();throw error;}
}
async function snapshot(h) {
 return {
  functions:await h.query(`select oid::regprocedure::text signature,pg_get_functiondef(oid) definition,proacl::text grants
   from pg_proc where pronamespace='public'::regnamespace order by signature`),
  patients:await h.query('select * from patients order by id'),
  goals:await h.query('select * from goals order by id'),
  notifications:await h.query('select * from parent_notifications order by id')
 };
}
test('both release verifiers accept migrations 001–013 in READ ONLY without modifying the schema or data',async()=>{
 const h=await currentFixture();try {
  const [notification]=await h.query(`select md5(regexp_replace(prosrc,'[[:space:]]','','g')) hash from pg_proc
   where oid='public.notify_parent_goal_publication()'::regprocedure`);
  assert.equal(notification.hash,'5324be33a033703dce16e6bdc1db0714','reviewed 013 body matches the operator-confirmed MD5');
  const before=await snapshot(h);
  for(const sql of checks)await h.db.exec(sql.replace(/rollback;\s*$/i,()=>`do $$ begin
   if current_setting('transaction_read_only')<>'on' then raise exception 'Verifier must remain READ ONLY';end if;
   end $$;rollback;`));
  assert.deepEqual(await snapshot(h),before);
 }finally{await h.db.close();}
});
test('all full-definition verifier references agree with the current migrated catalog',async()=>{
 const h=await currentFixture();try {
  await h.db.exec('set search_path=pg_catalog,public');
  const {functionDefinitionQuery}=await import('./generate-parent-portal-definition-reference.mjs');
  for(const name of ['verify_parent_portal_definitions.sql','verify_goal_parent_sync_definitions.sql']) {
   const expected=JSON.parse(included.get(name).match(/\$reviewed_reference\$([\s\S]*?)\$reviewed_reference\$::jsonb/)[1]);
   const names=expected.functions.map(f=>f.name);
   for(const added of ['normalize_goal_completion','sync_goal_parent_projection'])assert.ok(names.includes(added),name+': '+added);
   assert.deepEqual(await h.query(functionDefinitionQuery,[names]),expected.functions,name);
  }
 }finally{await h.db.close();}
});
test('both current verifiers reject the old 011 goal notification function and unknown 013 body drift',async()=>{
 const h=await currentFixture();try {
  const oldMigration=await readFile(new URL('migrations/20261003_011_parent_role_boundaries.sql',root),'utf8');
  const oldDefinition=oldMigration.match(/create or replace function public\.notify_parent_goal_publication\(\)[\s\S]*?\$\$;/i)[0];
  for(const sql of checks) {
   await h.db.exec('begin');
   try {
    await h.db.exec(oldDefinition);await h.db.exec('set transaction read only');
    await assert.rejects(h.db.exec(sql),/Unsafe signup\/goal function body|unreviewed parent security function definition/);
   }finally{await h.db.exec('rollback');}
   for(const name of ['notify_parent_goal_publication','normalize_goal_completion','sync_goal_parent_projection']) {
    const [row]=await h.query('select pg_get_functiondef(to_regprocedure($1)) definition',['public.'+name+'()']);
    await h.db.exec('begin');
    try {
     await h.db.exec(row.definition.replace('AS $function$','AS $function$/* unknown body drift */'));
     await h.db.exec('set transaction read only');
     await assert.rejects(h.db.exec(sql),/Unsafe signup\/goal function body|unreviewed parent security function definition/,name);
    }finally{await h.db.exec('rollback');}
   }
  }
 }finally{await h.db.close();}
});
