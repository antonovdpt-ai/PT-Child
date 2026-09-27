import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../media-fallback.css', import.meta.url), 'utf8');

test('unavailable patient media replaces the broken image with a clear status', () => {
  assert.match(app, /const showUnavailableState = \(\) =>/);
  assert.match(app, /unavailableState\.className = 'media-unavailable-state'/);
  assert.match(app, /unavailableState\.textContent = 'Файл недоступен'/);
  assert.match(app, /previewButton\.replaceChildren\(unavailableState\)/);
  assert.match(app, /previewButton\.disabled = true/);
});

test('unavailable patient media has a dedicated visible state', () => {
  assert.match(styles, /\.media-unavailable-state\s*\{/);
  assert.match(styles, /aspect-ratio:\s*4\s*\/\s*3/);
});
