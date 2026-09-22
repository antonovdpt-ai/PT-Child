import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(
  new URL('../../app.js', import.meta.url),
  'utf8'
);

test('parent report uses the Fizira brand', () => {
  assert.match(appSource, /Fizira · Отчёт для родителя/);
  assert.match(appSource, /Сформировано в Fizira/);
  assert.doesNotMatch(appSource, /PT Child · Отчёт для родителя/);
  assert.doesNotMatch(appSource, /Сформировано в PT Child/);
});

test('general analysis distinguishes independent and supported function', () => {
  assert.match(
    appSource,
    /«не выполняет самостоятельно» совместимо с описанием/
  );
  assert.match(
    appSource,
    /один и тот же уровень помощи и сопоставимые/
  );
  assert.match(
    appSource,
    /отмечай необходимость уточнения, а не утверждай противоречие/
  );
});
