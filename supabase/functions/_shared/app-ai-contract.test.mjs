import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(
  new URL('../../../app.js', import.meta.url),
  'utf8',
);

test('AI context builders omit database and direct child identifiers', () => {
  const start = app.indexOf('function buildNextSessionContext');
  const end = app.indexOf('async function prepareParentReportDraft');
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const contextBuilders = app.slice(start, end);
  assert.doesNotMatch(contextBuilders, /child_name/);
  assert.doesNotMatch(contextBuilders, /patient_id/);
  assert.doesNotMatch(contextBuilders, /therapist_id/);
  assert.doesNotMatch(contextBuilders, /\bid\s*:/);
});

test('AI file contract sends private storage paths, not signed URLs', () => {
  const start = app.indexOf('const aiFiles = selectedDocumentRows');
  const end = app.indexOf('const patientData', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const fileContract = app.slice(start, end);
  assert.match(fileContract, /storage_path: item\.storage_path/);
  assert.doesNotMatch(fileContract, /createSignedUrl/);
  assert.doesNotMatch(fileContract, /\burl\s*:/);
});
