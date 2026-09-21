import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/20260921_003_patient_media_path_integrity.sql',
    import.meta.url,
  ),
  'utf8',
);

test('patient_media storage paths are constrained to the therapist UUID prefix', () => {
  assert.match(migration, /patient_media_storage_path_owner_check/);
  assert.match(migration, /therapist_id::text\s*\|\|\s*'\/'/);
  assert.match(migration, /left\(storage_path, length\(therapist_id::text\) \+ 1\)/);
});

test('migration aborts before DDL when inconsistent rows already exist', () => {
  const guard = migration.indexOf('if exists (');
  const ddl = migration.indexOf('alter table public.patient_media');
  assert.notEqual(guard, -1);
  assert.notEqual(ddl, -1);
  assert.ok(guard < ddl);
  assert.match(migration, /migration aborted without changes/);
});
