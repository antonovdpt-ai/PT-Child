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

test('parent publication migration and verification keep clinical/Storage sources closed', async () => {
  const migration = await readFile(new URL('../../supabase/migrations/20261003_009_parent_portal_publications.sql',import.meta.url),'utf8');
  const verification = await readFile(new URL('../../supabase/verification/verify_migration.sql',import.meta.url),'utf8');
  for(const table of ['parent_session_reports','parent_session_report_media','parent_goal_publications','parent_notifications']) {
    assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration,new RegExp(`create policy account_must_be_active on public\\.${table} as restrictive`));
    assert.match(verification,new RegExp(`'${table}'`));
  }
  for(const name of ['parent_portal_children','parent_portal_dashboard','parent_portal_schedule','parent_portal_reports','parent_portal_report','parent_portal_goals','parent_portal_dynamics','parent_portal_notifications','parent_mark_notifications_read']) {
    assert.match(verification,new RegExp(`public\\.${name}\\(`));
  }
  assert.match(verification,/Unsafe parent publication policy/);
  assert.match(verification,/Clinical source policy must remain specialist-only/);
  assert.match(verification,/Parent Storage policy is forbidden/);
  assert.match(verification,/Missing publication guard trigger/);
  assert.doesNotMatch(migration,/create policy[^;]+on (?:public\.(?:sessions|patients|assessments|goals|patient_media|parent_reports|standardized_assessments)|storage\.)/i);
  assert.doesNotMatch(migration,/\b(?:sessions\.note|planned_session|tolerance|price_kopecks|paid_kopecks|ai_analysis|assessment_notes)\b/);
});
