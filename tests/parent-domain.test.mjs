import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatParentDate,
  formatParentAge,
  publicationLabel,
  dynamicsSeries,
  parentFileRequest,
  PARENT_NAV_ITEMS,
} from '../parent-domain.mjs';

const REPORT_ID = '123e4567-e89b-42d3-a456-426614174000';
const MEDIA_ID = '123e4567-e89b-42d3-a456-426614174001';

test('formats valid dates in Russian and safely labels missing or invalid dates', () => {
  assert.equal(formatParentDate('2024-02-09'), '9 февраля 2024 г.');
  assert.equal(formatParentDate('not-a-date'), 'Дата не указана');
  assert.equal(formatParentDate(null), 'Дата не указана');
});

test('formats age in months, Russian year forms, and clamps future dates', () => {
  const now = '2026-10-03';
  assert.equal(formatParentAge('2026-09-03', now), '1 мес.');
  assert.equal(formatParentAge('2024-10-03', now), '2 года');
  assert.equal(formatParentAge('2023-10-03', now), '3 года');
  assert.equal(formatParentAge('2021-10-03', now), '5 лет');
  assert.equal(formatParentAge('2023-07-03', now), '3 года 3 мес.');
  assert.equal(formatParentAge('2027-01-01', now), '0 мес.');
  assert.equal(formatParentAge('not-a-date', now), 'Возраст не указан');
  assert.equal(formatParentAge(null, now), 'Возраст не указан');
});

test('maps all publication states to parent-safe Russian labels', () => {
  assert.deepEqual(
    ['draft', 'publishing', 'published', 'publication_error', 'archived'].map(publicationLabel),
    ['Черновик', 'Публикуется…', 'Опубликовано для родителя', 'Ошибка публикации', 'В архиве'],
  );
  assert.equal(publicationLabel('future'), 'Неизвестный статус');
  assert.equal(publicationLabel('toString'), 'Неизвестный статус');
});

test('groups finite numeric GMFM/HINE values and categorical scale values without inference', () => {
  const rows = [
    { scale: 'gmfm66', assessed_at: '2025-02-01', value_numeric: 40.5, value_text: 'ignored' },
    { scale: 'gmfm66', assessed_at: '2024-02-01', value_numeric: 38 },
    { scale: 'hine', assessed_at: '2024-03-01', value_numeric: 62 },
    { scale: 'macs', assessed_at: '2024-01-01', value_text: 'II', value_numeric: 2 },
    { scale: 'gmfcs', assessed_at: '2024-04-01', value_text: 'III' },
    { scale: 'cfcs', assessed_at: '2024-05-01', value_text: ' ' },
    { scale: 'other', assessed_at: '2024-06-01', value_numeric: 1 },
    { scale: 'gmfm66', assessed_at: 'invalid', value_numeric: 99 },
    { scale: 'gmfm66', assessed_at: '2025-01-01', value_numeric: Infinity },
  ];

  assert.deepEqual(dynamicsSeries(rows), {
    numeric: [
      { scale: 'gmfm66', points: [
        { assessed_at: '2024-02-01', value: 38 },
        { assessed_at: '2025-02-01', value: 40.5 },
      ] },
      { scale: 'hine', points: [{ assessed_at: '2024-03-01', value: 62 }] },
    ],
    categorical: [
      { scale: 'macs', assessed_at: '2024-01-01', value: 'II' },
      { scale: 'gmfcs', assessed_at: '2024-04-01', value: 'III' },
    ],
  });
});

test('returns fresh allowlisted file request bodies', () => {
  const input = { kind: 'photo', reportId: REPORT_ID, mediaId: MEDIA_ID };
  const output = parentFileRequest(input);
  assert.deepEqual(output, { kind: 'photo', report_id: REPORT_ID, media_id: MEDIA_ID });
  assert.notEqual(output, input);
  assert.notEqual(parentFileRequest({ kind: 'pdf', reportId: REPORT_ID }), parentFileRequest({ kind: 'pdf', reportId: REPORT_ID }));
  assert.deepEqual(parentFileRequest({ kind: 'pdf', reportId: REPORT_ID }), { kind: 'pdf', report_id: REPORT_ID });
});

test('rejects file request paths, patient IDs, URLs, invalid UUIDs, and unknown keys', () => {
  const symbolKeyRequest = { kind: 'pdf', reportId: REPORT_ID };
  symbolKeyRequest[Symbol('extra')] = 'extra';
  const hiddenKeyRequest = { kind: 'pdf', reportId: REPORT_ID };
  Object.defineProperty(hiddenKeyRequest, 'extra', { value: 'extra' });
  for (const request of [
    { kind: 'pdf', reportId: REPORT_ID, storage_path: 'u/p/secret.pdf' },
    { kind: 'pdf', reportId: REPORT_ID, patientId: REPORT_ID },
    { kind: 'photo', reportId: REPORT_ID, mediaId: MEDIA_ID, url: 'https://example.test/file' },
    { kind: 'photo', reportId: REPORT_ID, mediaId: 'not-a-uuid' },
    { kind: 'other', reportId: REPORT_ID },
    { kind: 'photo', reportId: REPORT_ID },
    { kind: 'pdf', reportId: 'u/p/secret.pdf' },
    { kind: 'pdf', reportId: REPORT_ID, mediaId: MEDIA_ID },
    symbolKeyRequest,
    hiddenKeyRequest,
    Object.assign(Object.create({ storage_path: 'u/p/secret.pdf' }), { kind: 'pdf', reportId: REPORT_ID }),
    null,
  ]) {
    assert.throws(() => parentFileRequest(request), /Invalid parent file request/);
  }
});

test('exports the exact parent navigation items', () => {
  assert.deepEqual(PARENT_NAV_ITEMS, [
    { id: 'home', label: 'Главная' },
    { id: 'schedule', label: 'Расписание' },
    { id: 'reports', label: 'Отчёты' },
    { id: 'goals', label: 'Цели' },
    { id: 'dynamics', label: 'Динамика' },
  ]);
});
