import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(
  new URL('../../app.js', import.meta.url),
  'utf8'
);

test('browser dependency is pinned to an exact stable Supabase release', () => {
  assert.match(
    appSource,
    /@supabase\/supabase-js@2\.116\.0\/\+esm/
  );
  assert.doesNotMatch(
    appSource,
    /@supabase\/supabase-js@2\/\+esm/
  );
});

test('signed Storage URLs are validated before HTML rendering', () => {
  assert.match(appSource, /const safeStorageUrl =/);
  assert.doesNotMatch(appSource, /href="\$\{item\.url\}"/);
  assert.doesNotMatch(appSource, /src="\$\{item\.url\}"/);
  assert.doesNotMatch(appSource, /src="\$\{img\.dataset\.mediaPreview\}"/);
});

test('sign-out clears in-memory patient state', () => {
  assert.match(
    appSource,
    /event === 'SIGNED_OUT'[\s\S]*state = createEmptyState\(\)/
  );
});
