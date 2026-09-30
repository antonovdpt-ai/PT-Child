import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedOrigin,
  bytesToBase64,
  extractOcrText,
  extractResponseText,
  normalizeAiOperation,
  normalizePatientId,
  normalizeStoragePaths,
  parseJsonLines,
} from './ai-helpers.ts';

const patientId = '10000000-0000-4000-8000-000000000001';

test('accepts only storage paths for the authenticated user and selected patient', () => {
  assert.deepEqual(
    normalizeStoragePaths([{ storage_path: `user-1/${patientId}/file.pdf` }], 'user-1', patientId),
    [`user-1/${patientId}/file.pdf`],
  );
  assert.throws(() => normalizeStoragePaths(
    [{ storage_path: `user-2/${patientId}/file.pdf` }],
    'user-1',
    patientId,
  ));
  assert.throws(() => normalizeStoragePaths(
    [{ storage_path: 'user-1/20000000-0000-4000-8000-000000000002/file.pdf' }],
    'user-1',
    patientId,
  ));
  assert.throws(() => normalizeStoragePaths(
    [{ storage_path: `user-1/${patientId}/../file.pdf` }],
    'user-1',
    patientId,
  ));
});

test('rejects duplicate paths', () => {
  assert.throws(() => normalizeStoragePaths([
    { storage_path: `user-1/${patientId}/a.pdf` },
    { storage_path: `user-1/${patientId}/a.pdf` },
  ], 'user-1', patientId));
});

test('accepts only known AI operations and UUID patient ids', () => {
  assert.equal(normalizeAiOperation('patient_analysis'), 'patient_analysis');
  assert.equal(normalizeAiOperation('parent_report_draft'), 'parent_report_draft');
  assert.throws(() => normalizeAiOperation('arbitrary_prompt'));
  assert.equal(normalizePatientId(patientId), patientId);
  assert.throws(() => normalizePatientId('not-a-uuid'));
});

test('encodes bytes without argument overflow', () => {
  const bytes = new Uint8Array(100_000).fill(65);
  assert.equal(Buffer.from(bytesToBase64(bytes), 'base64').length, bytes.length);
});

test('extracts OCR camelCase and snake_case payloads', () => {
  assert.equal(extractOcrText({ result: { textAnnotation: { fullText: ' one ' } } }), 'one');
  assert.equal(extractOcrText({ result: { text_annotation: { blocks: [{ lines: [
    { alternatives: [{ text: 'one' }] },
    { alternatives: [{ text: 'two' }] },
  ] }] } } }), 'one\ntwo');
});

test('parses OCR JSONL', () => {
  assert.equal(parseJsonLines('{"page":1}\n{"page":2}\n').length, 2);
});

test('extracts Responses API output', () => {
  assert.equal(extractResponseText({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }), 'ok');
  assert.equal(extractResponseText({ output_text: 'compact' }), 'compact');
});

test('restricts browser origins', () => {
  const configured = 'https://app.fizira.com,https://staging.fizira.com';
  assert.equal(allowedOrigin('https://app.fizira.com', configured), 'https://app.fizira.com');
  assert.equal(allowedOrigin('https://evil.example', configured), null);
});
