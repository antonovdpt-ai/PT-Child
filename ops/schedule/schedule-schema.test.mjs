import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(
  new URL('../../supabase/migrations/20260923_005_specialist_schedule.sql', import.meta.url),
  'utf8',
);

assert.match(sql, /create table if not exists public\.appointments/i);
assert.match(sql, /exclude using gist/i);
assert.match(sql, /tstzrange\(starts_at, ends_at, '\[\)'\)/i);
assert.match(sql, /alter table public\.appointments enable row level security/i);
assert.match(sql, /appointments_insert_own/i);
assert.match(sql, /paid_kopecks <= price_kopecks/i);
assert.match(sql, /session_id is null or exists/i);

console.log('SCHEDULE_SCHEMA_STATIC_TEST_OK');
