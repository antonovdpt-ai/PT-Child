import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, localDate, periodBounds, periodRows, totals, debt, hourSlot, repeatDates, appointmentPayload, scheduleError, timeSlot, scheduleConflicts } from '../schedule-domain.mjs';

test('day and period calculations stay in local calendar time', () => {
  const date = localDate('2026-09-23');
  assert.equal(dayKey(date), '2026-09-23');
  assert.equal(dayKey(hourSlot('2026-09-23', 18)), '2026-09-23');
  assert.equal(hourSlot('2026-09-23', 18).getMinutes(), 0);
  const week = periodBounds(date, 'week');
  assert.equal(dayKey(week.from), '2026-09-21');
  assert.equal(dayKey(week.to), '2026-09-28');
});

test('earnings exclude planned, cancelled and no-show visits', () => {
  const rows = [
    { starts_at: '2026-09-23T08:00:00+03:00', kind: 'appointment', status: 'completed', price_kopecks: 300000 },
    { starts_at: '2026-09-23T09:00:00+03:00', kind: 'appointment', status: 'planned', price_kopecks: 250000 },
    { starts_at: '2026-09-23T10:00:00+03:00', kind: 'appointment', status: 'no_show', price_kopecks: 300000 },
    { starts_at: '2026-09-23T11:00:00+03:00', kind: 'break', status: 'completed', price_kopecks: 0 }
  ];
  assert.deepEqual(totals(rows), { count: 2, completed: 1, earned: 300000 });
  assert.equal(periodRows(rows, localDate('2026-09-23'), 'day').length, 4);
});

test('debt is only unpaid balance of completed visits', () => {
  const rows = [
    { id: 'old', patient_id: 'p1', kind: 'appointment', status: 'completed', price_kopecks: 300000, paid_kopecks: 100000 },
    { id: 'future', patient_id: 'p1', kind: 'appointment', status: 'planned', price_kopecks: 300000, paid_kopecks: 0 },
    { id: 'other', patient_id: 'p2', kind: 'appointment', status: 'completed', price_kopecks: 900000, paid_kopecks: 0 }
  ];
  assert.equal(debt(rows, 'p1'), 200000);
  assert.equal(debt(rows, 'p1', 'old'), 0);
});

test('recurrence preserves chosen hour and creates selected weekdays only', () => {
  const start = hourSlot('2026-09-23', 10); // Wednesday
  const dates = repeatDates(start, [1, 3, 5], 2);
  assert.deepEqual(dates.map(dayKey), ['2026-09-23', '2026-09-25', '2026-09-28', '2026-09-30', '2026-10-02', '2026-10-05']);
  assert.ok(dates.every(d => d.getHours() === 10 && d.getMinutes() === 0));
});

test('payload rounds to the hour, omits end-time input and preserves partial payment', () => {
  const payload = appointmentPayload({ date: '2026-09-23', hour: 15, kind: 'appointment', patient_id: 'p1', price: '3000', previous_paid: 50000, paid: false, note: ' test ' }, 'u1');
  assert.equal(new Date(payload.starts_at).getMinutes(), 0);
  assert.equal(new Date(payload.ends_at) - new Date(payload.starts_at), 3600000);
  assert.equal(payload.price_kopecks, 300000);
  assert.equal(payload.paid_kopecks, 50000);
  assert.equal(payload.note, 'test');
  assert.throws(() => appointmentPayload({ date: '2026-09-23', hour: 15, kind: 'appointment', price: 10, previous_paid: 2000 }, 'u1'), /оплату/);
});

test('database errors are converted to actionable messages', () => {
  assert.match(scheduleError({ code: '23P01' }), /время уже занято/i);
  assert.match(scheduleError({ message: 'SCHEDULE_STALE' }), /уже изменились/i);
  assert.match(scheduleError({ code: 'PGRST202' }), /006/);
});

test('minute payloads and repeats keep arbitrary minutes and exactly 60 elapsed minutes', () => {
  for (const minute of [0, 15, 17, 30, 45, 59]) {
    const payload = appointmentPayload({ date: '2030-01-14', hour: 23, minute, price: 3000 }, 'u1');
    assert.equal(new Date(payload.starts_at).getMinutes(), minute);
    assert.equal(new Date(payload.ends_at) - new Date(payload.starts_at), 3600000);
    assert.ok(repeatDates(new Date(payload.starts_at), [1, 3], 2).every(d => d.getMinutes() === minute));
  }
  for (const minute of [-1, 60, 1.5, 'x']) {
    assert.throws(() => appointmentPayload({ date: '2030-01-14', hour: 11, minute, price: 3000 }, 'u1'), /время|минут/i);
  }
});

test('minute interval checks cover preceding/following days, exact boundaries and inactive visits', () => {
  const block = (start, end, extra = {}) => ({ starts_at: start, ends_at: end, status: 'planned', ...extra });
  const candidate = block('2030-01-15T00:15:00Z', '2030-01-15T01:15:00Z');
  assert.equal(scheduleConflicts([candidate], [block('2030-01-14T23:30:00Z', '2030-01-15T00:30:00Z')]), true);
  assert.equal(scheduleConflicts([candidate], [block('2030-01-15T01:00:00Z', '2030-01-15T02:00:00Z')]), true);
  assert.equal(scheduleConflicts([candidate], [block('2030-01-14T23:15:00Z', '2030-01-15T00:15:00Z')]), false);
  assert.equal(scheduleConflicts([candidate], [block('2030-01-15T01:15:00Z', '2030-01-15T02:15:00Z')]), false);
  for (const status of ['cancelled', 'no_show']) assert.equal(scheduleConflicts([candidate], [{ ...candidate, status }]), false);
  assert.equal(scheduleConflicts([{ ...candidate, id: 'self' }], [{ ...candidate, id: 'self' }]), false);
  assert.equal(scheduleConflicts([candidate, { ...candidate }], []), true);
  assert.equal(timeSlot('2030-01-14', '11:17').getMinutes(), 17);
  for (const value of ['24:00', '11:60', '11:30x', '', '1:30']) assert.throws(() => timeSlot('2030-01-14', value), /ЧЧ:ММ/);
});
