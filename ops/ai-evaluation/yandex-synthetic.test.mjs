import test from 'node:test';
import assert from 'node:assert/strict';
import { cases, buildRequest, parseResponse, runCase } from './yandex-synthetic.mjs';
const env = { YANDEX_AI_API_KEY: 'test-not-a-key', YANDEX_AI_MODEL: 'test-model', YANDEX_FOLDER_ID: 'test-folder' };
const valid = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ facts: [], uncertainty: ['Недостаточно данных'], needs_review: true }) }] }] };
test('privacy settings and fixed endpoint', () => {
  const { url, options } = buildRequest(cases[0], env);
  assert.equal(url, 'https://ai.api.cloud.yandex.net/v1/responses');
  assert.equal(options.headers['x-data-logging-enabled'], 'false');
  assert.equal(JSON.parse(options.body).store, false);
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, 'Api-Key test-not-a-key');
  assert.equal(options.headers['x-folder-id'], 'test-folder');
});
test('reject arbitrary inputs', () => assert.throws(() => buildRequest({ input: 'external' }, env)));
test('require configuration', () => assert.throws(() => buildRequest(cases[0], {})));
test('accept required schema', () => assert.equal(parseResponse(valid).needs_review, true));
test('reject incomplete output', () => assert.throws(() => parseResponse({ ...valid, status: 'incomplete' })));
test('reject malformed output', () => assert.throws(() => parseResponse({ status: 'completed', output: [] })));
test('reject false review flag', () => assert.throws(() => parseResponse({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"facts":[],"uncertainty":[],"needs_review":false}' }] }] })));
test('mock successful transport', async () => {
  const result = await runCase(cases[0], env, async () => ({ ok: true, json: async () => valid }));
  assert.deepEqual(result.facts, []);
});
test('suppress provider error body', async () => {
  await assert.rejects(runCase(cases[0], env, async () => ({ ok: false, status: 403, json: async () => { throw new Error('secret'); } })), /^Error: Provider HTTP 403$/);
});
test('suppress transport details', async () => {
  await assert.rejects(runCase(cases[0], env, async () => { throw new Error('secret'); }), /^Error: Provider transport failed; details suppressed$/);
});
