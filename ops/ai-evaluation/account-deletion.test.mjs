import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../../supabase/migrations/20260922_004_account_deletion_jobs.sql', import.meta.url),
  'utf8',
);
const edgeFunction = await readFile(
  new URL('../../supabase/functions/delete-account/index.ts', import.meta.url),
  'utf8',
);

test('deletion tombstone survives auth deletion and blocks all user writes', () => {
  assert.match(migration, /user_id uuid primary key/);
  assert.doesNotMatch(migration, /references auth\.users/);
  assert.match(migration, /as restrictive for all to authenticated/);
  assert.match(migration, /on storage\.objects[\s\S]*as restrictive/);
  assert.match(migration, /not exists \([\s\S]*account_deletion_jobs/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /interval '15 minutes'/);
});

test('account deletion requires password verification before tombstone creation', () => {
  const verify = edgeFunction.indexOf('signInWithPassword');
  const tombstone = edgeFunction.indexOf('.from("account_deletion_jobs")', verify);
  assert.ok(verify > 0);
  assert.ok(tombstone > verify);
  assert.doesNotMatch(edgeFunction, /body\?\.user_id/);
});

test('deletion is retryable and removes storage before and after auth user', () => {
  const firstMediaDelete = edgeFunction.indexOf(
    'deleteUserFiles(supabaseAdmin, "patient-media"'
  );
  const authDelete = edgeFunction.indexOf('auth.admin.deleteUser');
  const secondMediaDelete = edgeFunction.indexOf(
    'deleteUserFiles(supabaseAdmin, "patient-media"',
    firstMediaDelete + 1,
  );
  assert.ok(firstMediaDelete > 0);
  assert.ok(authDelete > firstMediaDelete);
  assert.ok(secondMediaDelete > authDelete);
  assert.match(edgeFunction, /status: "retry"/);
  assert.match(edgeFunction, /processDueJobs/);
  assert.match(edgeFunction, /rpc\("claim_account_deletion_jobs"/);
  assert.match(edgeFunction, /constantTimeEqual/);
  assert.doesNotMatch(edgeFunction, /suppliedWorkerSecret === workerSecret/);
});
