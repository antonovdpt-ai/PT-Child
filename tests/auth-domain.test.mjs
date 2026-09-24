import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRenderAuthEvent } from '../auth-domain.mjs';

test('token refresh and repeated sign-in keep the current unsaved screen', () => {
  assert.equal(shouldRenderAuthEvent('TOKEN_REFRESHED', 'u1', 'u1'), false);
  assert.equal(shouldRenderAuthEvent('SIGNED_IN', 'u1', 'u1'), false);
  assert.equal(shouldRenderAuthEvent('USER_UPDATED', 'u1', 'u1'), false);
});

test('initial session and real account changes render the auth screen', () => {
  assert.equal(shouldRenderAuthEvent('INITIAL_SESSION', null, 'u1'), true);
  assert.equal(shouldRenderAuthEvent('SIGNED_IN', null, 'u1'), true);
  assert.equal(shouldRenderAuthEvent('SIGNED_OUT', 'u1', null), true);
  assert.equal(shouldRenderAuthEvent('SIGNED_IN', 'u1', 'u2'), true);
  assert.equal(shouldRenderAuthEvent('PASSWORD_RECOVERY', 'u1', 'u1'), true);
});
