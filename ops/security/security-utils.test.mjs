import assert from 'node:assert/strict';
import test from 'node:test';

import {
  escapeHtml,
  safeSameOriginHttpsUrl
} from '../../security-utils.mjs';

test('escapeHtml neutralizes HTML and attribute delimiters', () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('x')"> &`),
    '&lt;img src=x onerror=&quot;alert(&#039;x&#039;)&quot;&gt; &amp;'
  );
});

test('safeSameOriginHttpsUrl accepts an HTTPS URL from the configured backend', () => {
  assert.equal(
    safeSameOriginHttpsUrl(
      'https://auth.fizira.com/storage/v1/object/sign/patient-media/a.jpg?token=abc',
      'https://auth.fizira.com'
    ),
    'https://auth.fizira.com/storage/v1/object/sign/patient-media/a.jpg?token=abc'
  );
});

test('safeSameOriginHttpsUrl rejects script, insecure and foreign URLs', () => {
  const origin = 'https://auth.fizira.com';

  assert.equal(safeSameOriginHttpsUrl('javascript:alert(1)', origin), '');
  assert.equal(safeSameOriginHttpsUrl('http://auth.fizira.com/file', origin), '');
  assert.equal(safeSameOriginHttpsUrl('https://evil.example/file', origin), '');
  assert.equal(safeSameOriginHttpsUrl('not a URL', origin), '');
});
