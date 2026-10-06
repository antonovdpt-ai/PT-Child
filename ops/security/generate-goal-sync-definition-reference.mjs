// Offline only: preserve the 012 reference and derive a distinct 013 snapshot.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createFullParentSchemaFixture} from '../../tests/parent-full-schema-fixture.mjs';
import {functionDefinitionQuery} from './generate-parent-portal-definition-reference.mjs';
const root=new URL('../../',import.meta.url);
const baseline=await readFile(new URL('supabase/verification/verify_parent_portal_definitions.sql',root),'utf8');
const migration=await readFile(new URL('supabase/migrations/20261006_013_goal_parent_sync.sql',root),'utf8');
const pattern=/\$reviewed_reference\$([\s\S]*?)\$reviewed_reference\$::jsonb/;
const reference=JSON.parse(baseline.match(pattern)[1]);
const names=[...new Set([...reference.functions.map(f=>f.name),...migration.matchAll(/create or replace function public\.(\w+)\(/gi)].map(x=>typeof x==='string'?x:x[1]))].sort();
const h=await createFullParentSchemaFixture();
try{
 await h.db.exec(migration);await h.db.exec('set search_path=pg_catalog,public');
 reference.functions=await h.query(functionDefinitionQuery,[names]);
 const text='-- GENERATED offline by ops/security/generate-goal-sync-definition-reference.mjs\n-- 013 sha256='+createHash('sha256').update(migration).digest('hex')+'\n'+baseline.slice(baseline.indexOf('do $verify_definitions$')).replace(pattern,()=>'$reviewed_reference$'+JSON.stringify(reference,null,2)+'$reviewed_reference$::jsonb');
 await writeFile(new URL('supabase/verification/verify_goal_parent_sync_definitions.sql',root),text);
}finally{await h.db.close();}
