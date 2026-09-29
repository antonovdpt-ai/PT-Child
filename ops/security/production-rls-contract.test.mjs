import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const script = await readFile(
  new URL('./test-production-rls.mjs', import.meta.url),
  'utf8',
);

test('production RLS test is synthetic, explicit and cleans up', () => {
  assert.match(script, /FIZIRA_RLS_E2E_CONFIRM/);
  assert.match(script, /synthetic-production-test/);
  assert.match(script, /@example\.invalid/);
  assert.match(script, /finally\s*\{[\s\S]*cleanup\(\)/);
  assert.doesNotMatch(script, /service_role\s*[:=]\s*['"][A-Za-z0-9._-]{20,}/i);
});

test('production RLS test covers every current application table', () => {
  for (const table of [
    'ai_analysis_history',
    'assessments',
    'goals',
    'parent_reports',
    'patient_contacts',
    'patient_media',
    'patients',
    'profiles',
    'sessions',
    'standardized_assessments',
    'user_consents',
  ]) {
    assert.match(script, new RegExp(`['"]${table}['"]`), table);
  }
});

test('production RLS test checks cross-user writes, Storage and anonymous access', () => {
  assert.match(script, /crossUpdate/);
  assert.match(script, /crossDelete/);
  assert.match(script, /spoofedOwner/);
  assert.match(script, /crossRelation/);
  assert.match(script, /mismatchedStoragePath/);
  assert.match(script, /crossDownload/);
  assert.match(script, /crossUpload/);
  assert.match(script, /anonRows/);
  assert.match(script, /anonDownload/);
  assert.match(script, /RLS_AUTH_STORAGE_SYNTHETIC_OK/);
});
