const DATE_MISSING = 'Дата не указана';
const AGE_MISSING = 'Возраст не указан';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PARENT_NAV_ITEMS = [
  { id: 'home', label: 'Главная' },
  { id: 'schedule', label: 'Расписание' },
  { id: 'reports', label: 'Отчёты' },
  { id: 'goals', label: 'Цели' },
  { id: 'dynamics', label: 'Динамика' },
];

function validDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value !== 'string' || !value.trim()) return null;

  const input = value.trim();
  if (DATE_ONLY.test(input)) {
    const [year, month, day] = input.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, 12));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date;
  }

  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateParts(date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
  };
}

export function formatParentDate(value) {
  const date = validDate(value);
  if (!date) return DATE_MISSING;
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric',
  }).format(date);
}

export function formatParentAge(dateOfBirth, now = new Date()) {
  const birthDate = validDate(dateOfBirth);
  const currentDate = validDate(now);
  if (!birthDate || !currentDate) return AGE_MISSING;

  const birth = dateParts(birthDate);
  const current = dateParts(currentDate);
  let months = (current.year - birth.year) * 12 + current.month - birth.month;
  if (current.day < birth.day) months--;
  months = Math.max(0, months);

  if (months < 24) return `${months} мес.`;
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  const yearWord = years === 1 ? 'год' : years >= 2 && years <= 4 ? 'года' : 'лет';
  return remainder ? `${years} ${yearWord} ${remainder} мес.` : `${years} ${yearWord}`;
}

const PUBLICATION_LABELS = {
  draft: 'Черновик',
  publishing: 'Публикуется…',
  published: 'Опубликовано для родителя',
  publication_error: 'Ошибка публикации',
  archived: 'В архиве',
};

export function publicationLabel(status) {
  return Object.hasOwn(PUBLICATION_LABELS, status) ? PUBLICATION_LABELS[status] : 'Неизвестный статус';
}

const NUMERIC_SCALES = new Set(['gmfm66', 'hine']);
const CATEGORICAL_SCALES = new Set(['gmfcs', 'macs', 'cfcs', 'edacs']);

function validAssessmentDate(value) {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) return false;
  return Boolean(validDate(value));
}

export function dynamicsSeries(rows) {
  const grouped = new Map();
  const categorical = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object' || !validAssessmentDate(row.assessed_at)) continue;

    if (NUMERIC_SCALES.has(row.scale) && Number.isFinite(row.value_numeric)) {
      if (!grouped.has(row.scale)) grouped.set(row.scale, []);
      grouped.get(row.scale).push({ assessed_at: row.assessed_at, value: row.value_numeric });
    } else if (CATEGORICAL_SCALES.has(row.scale) && typeof row.value_text === 'string' && row.value_text.trim()) {
      categorical.push({ scale: row.scale, assessed_at: row.assessed_at, value: row.value_text });
    }
  }

  const numeric = [...grouped].map(([scale, points]) => ({
    scale,
    points: points.sort((a, b) => a.assessed_at.localeCompare(b.assessed_at)),
  }));
  categorical.sort((a, b) => a.assessed_at.localeCompare(b.assessed_at));
  return { numeric, categorical };
}

export function parentFileRequest(input) {
  const invalid = () => { throw new Error('Invalid parent file request'); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const keys = Reflect.ownKeys(input);
  if (keys.some(key => !['kind', 'reportId', 'mediaId'].includes(key))) return invalid();
  if (!['pdf', 'photo'].includes(input.kind) || typeof input.reportId !== 'string' || !UUID.test(input.reportId)) return invalid();
  if (input.kind === 'photo') {
    if (typeof input.mediaId !== 'string' || !UUID.test(input.mediaId)) return invalid();
    return { kind: 'photo', report_id: input.reportId, media_id: input.mediaId };
  }
  if (Object.hasOwn(input, 'mediaId')) return invalid();
  return { kind: 'pdf', report_id: input.reportId };
}
