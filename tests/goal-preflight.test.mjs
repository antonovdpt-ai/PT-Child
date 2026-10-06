import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createFullParentSchemaFixture} from './parent-full-schema-fixture.mjs';

test('goal production preflight executes read-only and exposes aggregates, not clinical text',async()=>{
 const {db,query}=await createFullParentSchemaFixture();
 try{
  const sql=await readFile(new URL('../supabase/verification/preflight_goal_parent_sync.sql',import.meta.url),'utf8');
  const result=await db.exec(sql);
  const summary=result.flatMap(r=>r.rows||[]).find(r=>r.check_name==='goal_publication_preflight');
  assert.ok(summary);
  assert.equal(Number(summary.duplicate_goal_groups),0);
  assert.equal(Number(summary.ownership_mismatches),0);
  assert.equal((await query("select current_setting('transaction_read_only') as value"))[0].value,'off');
  await db.exec('begin read only');
  await assert.rejects(db.exec('create table forbidden_preflight_write(id integer)'),/read.only/i);
  await db.exec('rollback');
  assert.doesNotMatch(sql,/select\s+\*|g\.title\s+as|p\.description\s+as/i);
 }finally{await db.close();}
});
