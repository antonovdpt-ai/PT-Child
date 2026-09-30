import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(
  new URL('../../../app.js', import.meta.url),
  'utf8',
);
const edge = readFileSync(
  new URL('../ptchild-ai/index.ts', import.meta.url),
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

test('every browser AI request includes an operation and patient id', () => {
  const start = app.indexOf('async function callAI');
  const end = app.indexOf('async function analyzeSessionDraft', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const requestContract = app.slice(start, end);
  assert.match(requestContract, /operation:\s*cleanOperation/);
  assert.match(requestContract, /patient_id:\s*cleanPatientId/);

  const operations = [...app.matchAll(
    /await callAI\("([a-z_]+)",\s*[^,\n]+,\s*prompt(?:,\s*aiFiles)?\);/g,
  )].map((match) => match[1]).sort();
  assert.deepEqual(operations, [
    'dynamics_analysis',
    'next_session_plan',
    'parent_report_draft',
    'patient_analysis',
    'session_draft',
  ]);
});

test('AI Edge Function verifies patient ownership before handling prompts or files', () => {
  const patientCheck = edge.indexOf('.from("patients")');
  const promptRead = edge.indexOf('const prompt =');
  const pathRead = edge.indexOf('normalizeStoragePaths(body?.files');

  assert.notEqual(patientCheck, -1);
  assert.ok(patientCheck < promptRead);
  assert.ok(patientCheck < pathRead);
  assert.match(edge, /if \(patientError \|\| !patient\) throw new PublicError\(403, "Patient is unavailable"\)/);
  assert.match(edge, /normalizeStoragePaths\(body\?\.files \?\? \[\], user\.id, patientId\)/);
  assert.match(edge, /\.from\("patient_media"\)[\s\S]*?\.eq\("patient_id", patientId\)[\s\S]*?\.in\("storage_path", paths\)/);
});

test('AI file transfer is fail-closed unless each file class is explicitly enabled', () => {
  assert.match(edge, /Deno\.env\.get\("FIZIRA_ALLOW_IMAGE_AI"\) !== "yes"/);
  assert.match(edge, /throw new PublicError\(503, "Image analysis is not enabled"\)/);
  assert.match(edge, /Deno\.env\.get\("FIZIRA_ALLOW_PDF_OCR"\) !== "yes"/);
  assert.match(edge, /throw new PublicError\(503, "PDF analysis is not enabled"\)/);
  assert.match(edge, /"x-data-logging-enabled": "false"/);
  assert.match(edge, /store: false/);
});
