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

test('browser AI requests use structured input and never send a free-form prompt', () => {
  const start = app.indexOf('async function callAI');
  const end = app.indexOf('async function analyzeSessionDraft', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const requestContract = app.slice(start, end);
  assert.match(requestContract, /operation:\s*cleanOperation/);
  assert.match(requestContract, /patient_id:\s*cleanPatientId/);
  assert.match(requestContract, /input,/);
  assert.doesNotMatch(requestContract, /prompt:/);

  const operations = [...app.matchAll(
    /await callAI\("([a-z_]+)"/g,
  )].map((match) => match[1]).sort();
  assert.deepEqual(operations, [
    'dynamics_analysis',
    'next_session_plan',
    'parent_report_draft',
    'patient_analysis',
    'session_draft',
  ]);
});

test('AI Edge Function verifies patient ownership before building context or handling files', () => {
  const patientCheck = edge.indexOf('.from("patients")');
  const promptBuild = edge.indexOf('await buildServerPrompt');
  const pathRead = edge.indexOf('normalizeStoragePaths(body?.files');

  assert.notEqual(patientCheck, -1);
  assert.ok(patientCheck < promptBuild);
  assert.ok(patientCheck < pathRead);
  assert.match(edge, /if \(patientError \|\| !patient\) throw new PublicError\(403, "Patient is unavailable"\)/);
  assert.match(edge, /normalizeStoragePaths\(body\?\.files \?\? \[\], user\.id, patientId\)/);
  assert.match(edge, /\.from\("patient_media"\)[\s\S]*?\.eq\("patient_id", patientId\)[\s\S]*?\.in\("storage_path", paths\)/);
});

test('AI Edge Function rejects free-form prompts and builds allowlisted context server-side', () => {
  assert.match(edge, /hasOwnProperty\.call\(body, "prompt"\)/);
  assert.match(edge, /throw new PublicError\(400, "Free-form prompts are not accepted"\)/);
  assert.match(edge, /normalizedOperationInput\(operation, body\?\.input, \[patient\.display_name\]\)/);
  assert.match(edge, /\.from\("assessments"\)/);
  assert.match(edge, /\.from\("goals"\)/);
  assert.match(edge, /\.from\("sessions"\)/);
  assert.match(edge, /JSON\.stringify\(context\)/);
  assert.doesNotMatch(
    edge.slice(edge.indexOf('const context ='), edge.indexOf('const taskByOperation')),
    /display_name|therapist_id|patient_id/,
  );
});

test('only session drafts accept caller text and direct identifiers are scrubbed', () => {
  assert.match(edge, /operation !== "session_draft"/);
  assert.match(edge, /fields\.length !== 1 \|\| fields\[0\] !== "transcript"/);
  assert.match(edge, /\[email удалён\]/);
  assert.match(edge, /\[телефон удалён\]/);
  assert.match(edge, /\[идентификатор удалён\]/);
  assert.match(edge, /\[ссылка удалена\]/);
  assert.match(edge, /\.select\("id,display_name,date_of_birth,sex,primary_complaint"\)/);
  assert.match(edge, /\[имя удалено\]/);
});

test('AI file transfer is fail-closed unless each file class is explicitly enabled', () => {
  assert.match(edge, /Deno\.env\.get\("FIZIRA_ALLOW_IMAGE_AI"\) !== "yes"/);
  assert.match(edge, /throw new PublicError\(503, "Image analysis is not enabled"\)/);
  assert.match(edge, /Deno\.env\.get\("FIZIRA_ALLOW_PDF_OCR"\) !== "yes"/);
  assert.match(edge, /throw new PublicError\(503, "PDF analysis is not enabled"\)/);
  assert.match(edge, /"x-data-logging-enabled": "false"/);
  assert.match(edge, /store: false/);
});
