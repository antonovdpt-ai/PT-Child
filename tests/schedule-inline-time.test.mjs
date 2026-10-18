import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { scheduleFixture, fixtureDay, at, visit, waitFor } from './schedule-inline-fixture.mjs';

async function setup(rows = []) {
  const window = new Window({ url: 'http://fizira.test' });
  Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage });
  window.confirm = () => true;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  document.body.innerHTML = '<main id="app"></main>';
  const h = scheduleFixture(rows); await h.mount();
  h.day = () => document.querySelector(`[data-day="${fixtureDay}"]`);
  h.label = hour => h.day().querySelector(`[data-time="${hour}"]`);
  h.editTime = async (hour, value, key = 'Enter') => {
    h.label(hour).click(); const input = h.day().querySelector('[data-time-input]');
    assert.ok(input, 'left time label must become an inline input');
    input.value = value;
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
    await waitFor(() => !document.querySelector('[data-time-input]:disabled'));
    return input;
  };
  h.close = () => window.happyDOM.abort();
  return h;
}

test('11:00 → 11:30 creates a real 60-minute visit and survives a fresh calendar mount', async () => {
  const h = await setup();
  try {
    assert.ok(h.label(11), '11:00 in the left column must be clickable');
    const count = h.day().querySelectorAll('.calendar-slot').length;
    await h.editTime(11, '11:30');
    assert.equal(h.label(11).textContent, '11:30');
    assert.equal(h.day().querySelectorAll('.calendar-slot').length, count);
    assert.equal(h.label(12).textContent, '12:00', 'neighbor time stays unchanged');
    assert.equal(h.rpcs.length, 0, 'an empty-slot choice must never create a placeholder');
    h.day().querySelector('[data-slot="11"]').click();
    const hour = document.querySelector('[name="hour"]');
    assert.equal(hour.options[hour.selectedIndex].textContent, '11:30');
    assert.equal(document.querySelectorAll('dialog [name="time"], [data-custom-time]').length, 0);
    document.querySelector('[data-patient="fictional-child"]').click();
    document.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await waitFor(() => !document.querySelector('dialog'));
    assert.equal(h.appointments.length, 1);
    assert.equal(h.appointments[0].starts_at, at('11:30'));
    assert.equal(new Date(h.appointments[0].ends_at) - new Date(h.appointments[0].starts_at), 3600000);
    await h.mount();
    assert.equal(h.label(11).textContent, '11:30');
    assert.equal(h.day().querySelector('[data-slot="12"]'), null, '11:30–12:30 blocks 12:00–13:00');
  } finally { await h.close(); }
});

test('inline move writes only the chosen visit and preserves minutes when its existing form is saved', async () => {
  const h = await setup([visit('chosen', '11:00'), visit('neighbor', '13:00')]);
  try {
    const neighbor = structuredClone(h.appointments[1]);
    assert.ok(h.label(11), 'existing visit must have an editable left time label');
    await h.editTime(11, '11:17');
    await waitFor(() => h.label(11)?.textContent === '11:17');
    assert.equal(h.rpcs.length, 1);
    assert.equal(h.rpcs[0].args.entries.length, 1);
    assert.equal(h.rpcs[0].args.entries[0].id, 'chosen');
    assert.equal(h.rpcs[0].args.entries[0].expected_updated_at, '2026-10-18T08:00:00.000Z');
    assert.equal(h.rpcs[0].args.save_tariff, false);
    assert.deepEqual(h.appointments[1], neighbor);
    assert.equal(h.appointments[0].paid_kopecks, 100000);
    await h.mount();
    assert.equal(h.label(11).textContent, '11:17');
    h.day().querySelector('[data-edit="chosen"]').click();
    document.querySelector('[name="note"]').value = 'Изменён только комментарий';
    document.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await waitFor(() => !document.querySelector('dialog'));
    assert.equal(h.appointments[0].starts_at, at('11:17'));
    assert.deepEqual(h.appointments[1], neighbor);
    await h.editTime(11, '10:45');
    await waitFor(() => h.label(10)?.textContent === '10:45');
    assert.equal(h.appointments[0].starts_at, at('10:45'));
    assert.equal(h.label(11).textContent, '11:00');
  } finally { await h.close(); }
});

test('Escape cancels an edit and invalid HH:MM never writes or normalizes to another time', async () => {
  const h = await setup([visit('chosen', '11:00')]);
  try {
    assert.ok(h.label(11), 'time label must support editing');
    await h.editTime(11, '11:45', 'Escape');
    assert.equal(h.label(11).textContent, '11:00');
    for (const value of ['24:00', '11:60', '', '11:30x']) {
      const input = await h.editTime(11, value);
      assert.ok(input.isConnected, 'invalid input stays open for correction');
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
      assert.equal(h.label(11).textContent, '11:00');
    }
    assert.equal(h.rpcs.length, 0);
  } finally { await h.close(); }
});

test('60-minute overlap is rejected for creation and moves; touching endpoints remain allowed', async () => {
  const h = await setup([visit('chosen', '11:00'), visit('neighbor', '12:00')]);
  try {
    assert.ok(h.label(11), 'time label must support editing');
    await h.editTime(11, '11:30');
    assert.equal(h.rpcs.length, 0);
    assert.equal(h.appointments[0].starts_at, at('11:00'));
    assert.match(document.querySelector('.error[role="alert"]').textContent, /время уже занято/i);
    assert.equal(h.label(11).textContent, '11:00');
    await h.editTime(10, '10:15');
    assert.equal(h.label(10).textContent, '10:00', 'empty choice also checks its full 60 minutes');
    await h.editTime(11, '10:00');
    await waitFor(() => h.appointments[0].starts_at === at('10:00'));
    assert.equal(h.appointments[1].starts_at, at('12:00'));
  } finally { await h.close(); }
});

test('server overlap/stale rejection restores the old label without changing local appointments', async () => {
  for (const error of [{ code: '23P01' }, { message: 'SCHEDULE_STALE' }]) {
    const h = await setup([visit('chosen', '11:00')]);
    try {
      assert.ok(h.label(11), 'time label must support editing');
      h.nextError = error;
      await h.editTime(11, '11:45');
      await waitFor(() => document.querySelector('.error[role="alert"]').textContent);
      assert.equal(h.label(11).textContent, '11:00');
      assert.equal(h.appointments[0].starts_at, at('11:00'));
      assert.equal(h.rpcs.length, 1);
    } finally { await h.close(); }
  }
});

test('an inactive visit in the same hour cannot be mistaken for the active visit', async () => {
  const h = await setup([visit('cancelled', '11:00', { status: 'cancelled' }), visit('active', '11:15')]);
  try {
    assert.ok(h.label(11), 'time label must support editing');
    assert.equal(h.label(11).textContent, '11:15');
    await h.editTime(11, '11:30');
    await waitFor(() => h.appointments[1].starts_at === at('11:30'));
    assert.equal(h.appointments[0].starts_at, at('11:00'));
    assert.equal(h.rpcs[0].args.entries[0].id, 'active');
  } finally { await h.close(); }
});

test('confirming a valid empty time by blur keeps its booking button usable', async () => {
  const h = await setup();
  try {
    h.label(11).click();
    const input = document.querySelector('[data-time-input]');
    const booking = h.day().querySelector('[data-slot="11"]');
    input.value = '11:30'; input.dispatchEvent(new window.Event('blur'));
    assert.ok(booking.isConnected, 'blur must not remove the button the user is about to click');
    booking.click();
    assert.equal(document.querySelector('[name="hour"]').value, '11');
    const hour = document.querySelector('[name="hour"]');
    assert.equal(hour.options[hour.selectedIndex].textContent, '11:30');
    assert.equal(h.rpcs.length, 0);
  } finally { await h.close(); }
});

test('the unchanged booking form rejects minute collisions, including a repeat on another date', async () => {
  const h = await setup([visit('neighbor', '12:15', { starts_at: at('12:15', '2030-01-16'), ends_at: at('13:15', '2030-01-16') })]);
  try {
    await h.editTime(11, '11:30');
    h.day().querySelector('[data-slot="11"]').click();
    document.querySelector('[data-patient="fictional-child"]').click();
    document.querySelector('[name="weekday"][value="3"]').checked = true;
    document.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    assert.equal(h.rpcs.length, 0, 'an overlapping repeat is rejected before writing any entries');
    assert.match(document.querySelector('dialog [data-error]').textContent, /время уже занято/i);
    assert.equal(h.appointments.length, 1);
    document.querySelector('[name="weekday"][value="3"]').checked = false;
    const hour = document.querySelector('[name="hour"]'); hour.value = '12';
    document.querySelector('[name="date"]').value = '2030-01-16';
    document.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    assert.equal(h.rpcs.length, 0, '12:00–13:00 overlaps a later 12:15 start');
  } finally { await h.close(); }
});

test('retired account cannot repaint the calendar after a pending inline save', async () => {
  const h = await setup([visit('chosen', '11:00')]);
  try {
    let finish;
    h.beforeSave = () => new Promise(resolve => { finish = resolve; });
    h.label(11).click();
    const input = document.querySelector('[data-time-input]'); input.value = '11:30';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
    await waitFor(() => finish);
    h.current = false; document.querySelector('#app').textContent = 'Другой аккаунт'; finish();
    await waitFor(() => h.appointments[0].starts_at === at('11:30'));
    assert.equal(document.querySelector('#app').textContent, 'Другой аккаунт');
  } finally { await h.close(); }
});

test('booking beside a cancelled minute visit uses exactly the time displayed on the left', async () => {
  const h = await setup([visit('cancelled', '11:15', { status: 'cancelled' })]);
  try {
    assert.equal(h.label(11).textContent, '11:15');
    h.day().querySelector('[data-slot="11"]').click();
    const hour = document.querySelector('[name="hour"]');
    assert.equal(hour.options[hour.selectedIndex].textContent, '11:15');
    document.querySelector('[data-patient="fictional-child"]').click();
    document.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await waitFor(() => !document.querySelector('dialog'));
    assert.equal(h.appointments[1].starts_at, at('11:15'));
    assert.equal(h.appointments[0].status, 'cancelled');
  } finally { await h.close(); }
});

test('refresh cannot race an inline save and replace its label with a stale read', async () => {
  const h = await setup([visit('chosen', '11:00')]);
  let finish;
  try {
    h.beforeSave = () => new Promise(resolve => { finish = resolve; });
    h.label(11).click(); const input = document.querySelector('[data-time-input]');
    input.value = '11:30'; input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
    await waitFor(() => finish);
    const reads = h.appointmentReads;
    document.querySelector('[data-refresh]').click();
    assert.equal(h.appointmentReads, reads, 'manual refresh must not snapshot the old time while the write is pending');
    finish(); await waitFor(() => h.label(11)?.textContent === '11:30');
    assert.equal(h.appointments[0].starts_at, at('11:30'));
    assert.equal(document.querySelector('[data-refresh]').disabled, false);
  } finally { finish?.(); await h.close(); }
});
