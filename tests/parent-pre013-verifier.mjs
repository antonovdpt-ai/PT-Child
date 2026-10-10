// TEST ONLY: 011/012 transition fixtures deliberately retain the notification
// body from 011. Never feed this historical assertion set to a release auditor.
// The current verifier and current-schema integration tests stay strictly 013.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export async function loadPre013ParentVerifier() {
 const root=new URL('../supabase/',import.meta.url);
 const migration=await readFile(new URL('migrations/20261003_011_parent_role_boundaries.sql',root),'utf8');
 const oldBody=migration.match(/create or replace function public\.notify_parent_goal_publication\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i)?.[1];
 assert.ok(oldBody,'reviewed 011 notification body must exist');
 const current=await readFile(new URL('verification/verify_migration.sql',root),'utf8');
 const pattern=/('public\.notify_parent_goal_publication\(\)',\$body\$)[\s\S]*?\$body\$/g;
 assert.equal([...current.matchAll(pattern)].length,1,'replace exactly one historical expectation');
 return current.replace(pattern,(_match,prefix)=>prefix+oldBody+'$body$').replace(/^\\set[^\n]*\n/gm,'');
}
