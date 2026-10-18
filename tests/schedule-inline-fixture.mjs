// Synthetic Supabase transport for DOM/browser tests. No credentials or network.
import { renderCabinet } from '../cabinet.js';
import { escapeHtml } from '../security-utils.mjs';

export const fixtureDay = '2030-01-14';
export const at = (time, day = fixtureDay) => new Date(`${day}T${time}:00`).toISOString();
export const visit = (id, time, extra = {}) => ({
  id, patient_id: 'fictional-child', initial_name: null, starts_at: at(time),
  ends_at: new Date(new Date(at(time)).getTime() + 3600000).toISOString(),
  kind: 'appointment', status: 'planned', price_kopecks: 300000, paid_kopecks: 100000,
  note: 'Вымышленная запись', updated_at: '2026-10-18T08:00:00.000Z', ...extra
});
export async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) {
    const value = predicate(); if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Schedule fixture timed out');
}
export function scheduleFixture(rows = []) {
  const appointments = structuredClone(rows), rpcs = [];
  const patients = [{ id: 'fictional-child', display_name: 'Вымышленный пациент', schedule_price_kopecks: 300000 }];
  let sequence = 0;
  const fixture = { appointments, patients, rpcs, nextError: null, current: true, appointmentReads: 0 };
  const sb = {
    from(table) {
      const filters = [];
      const result = () => ({ data: structuredClone((table === 'appointments' ? appointments : table === 'patients' ? patients : [])
        .filter(row => filters.every(([key, value]) => key === 'therapist_id' || row[key] === value))), error: null });
      return { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; }, order() { return this; },
        async range(from, to) { if (table === 'appointments') fixture.appointmentReads++; const data = result(); data.data = data.data.slice(from, to + 1); return data; },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); } };
    },
    async rpc(name, args) {
      rpcs.push(structuredClone({ name, args }));
      if (fixture.nextError) { const error = fixture.nextError; fixture.nextError = null; return { error }; }
      if (fixture.beforeSave) await fixture.beforeSave();
      for (const entry of args.entries) {
        const index = appointments.findIndex(row => row.id === entry.id);
        const saved = { ...entry, id: entry.id || `fictional-new-${++sequence}`, updated_at: `2030-01-01T08:00:${String(++sequence).padStart(2, '0')}.000Z` };
        delete saved.expected_updated_at;
        if (index < 0) appointments.push(saved); else appointments[index] = saved;
      }
      return { data: args.entries.length, error: null };
    }
  };
  fixture.mount = async (app = document.getElementById('app')) => {
    await renderCabinet({ app, sb, state: {}, user: { id: 'fictional-owner' }, esc: escapeHtml,
      isCurrent: () => fixture.current, renderPatients() {}, renderProfile() {} });
    await waitFor(() => app.querySelector('[data-copy]'));
    const date = app.querySelector('[data-date]'); date.value = fixtureDay;
    date.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(() => app.querySelector(`[data-day="${fixtureDay}"] [data-slot]`));
  };
  return fixture;
}
