// Synthetic specialist, child and visits for the patient card regression test.
export function makeSessionHistoryClient(now = new Date()) {
  const patient = { id: 'synthetic-patient', display_name: 'Тестовый ребёнок', date_of_birth: '2020-06-12', sex: 'unspecified', status: 'active' };
  const profile = { id: 'synthetic-owner', full_name: 'Тестовый специалист', profession: 'Физический терапевт' };
  const dateKey = date => [
    date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')
  ].join('-');
  const month = dateKey(now).slice(0, 7);
  const previousMonth = dateKey(new Date(now.getFullYear(), now.getMonth(), 0));
  const base = { patient_id: patient.id, note: null, tolerance: null, voided_at: null, updated_at: `${month}-10T09:00:00Z`, has_clinical_data: false };
  const sessions = [
    { ...base, id: 'synthetic-filled', origin: 'schedule', session_date: `${month}-07`, scheduled_at: `${month}-07T06:15:00Z`, schedule_timezone: 'Europe/Moscow', note: 'С опорой стоял 20 секунд.', tolerance: 'good', has_clinical_data: true },
    { ...base, id: 'synthetic-empty', origin: 'schedule', session_date: `${month}-07`, scheduled_at: `${month}-07T07:30:00Z`, schedule_timezone: 'Europe/Moscow' },
    { ...base, id: 'synthetic-manual', origin: 'manual', session_date: previousMonth, function_changes: 'Перенёс вес на левую ногу.', has_clinical_data: true },
    { ...base, id: 'synthetic-voided', origin: 'schedule', session_date: `${month}-08`, voided_at: `${month}-09T00:00:00Z`, note: 'Скрытая запись', has_clinical_data: true }
  ];
  const tables = { profiles: [profile], patients: [patient], sessions };
  const writes = [];

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.orders = [];
      this.rows = tables[table] || [];
    }
    select() { return this; }
    eq(key, value) { this.filters.push(row => row[key] === value || JSON.stringify(row[key]) === value); return this; }
    is(key, value) { this.filters.push(row => row[key] === value); return this; }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
    order(key, { ascending = true } = {}) { this.orders.push([key, ascending]); return this; }
    limit(count) { this.to = count; return this; }
    range(from, to) { this.from = from; this.to = to + 1; return this; }
    update(values) { this.values = values; this.action = 'update'; return this; }
    insert(values) { this.values = values; this.action = 'insert'; return this; }
    maybeSingle() { this.singleRow = true; return this; }
    single() { return this.maybeSingle(); }
    then(resolve, reject) {
      return Promise.resolve().then(() => this.run()).then(resolve, reject);
    }
    run() {
      let rows = this.rows.filter(row => this.filters.every(predicate => predicate(row)));
      if (this.action) {
        writes.push({ table: this.table, action: this.action, values: this.values });
        if (this.action === 'insert') {
          rows = [{ ...base, id: 'synthetic-created', origin: 'manual', ...this.values }];
          this.rows.push(...rows);
        } else {
          rows.forEach(row => Object.assign(row, this.values));
        }
        if (this.table === 'sessions') rows.forEach(row => { row.has_clinical_data = Boolean(row.note || row.function_changes || row.tolerance); });
      }
      rows.sort((a, b) => {
        for (const [key, ascending] of this.orders) {
          const diff = String(a[key] || '').localeCompare(String(b[key] || ''));
          if (diff) return ascending ? diff : -diff;
        }
        return 0;
      });
      const data = rows.slice(this.from, this.to);
      return { data: this.singleRow ? data[0] || null : data, error: null };
    }
  }

  return {
    auth: {
      onAuthStateChange() {},
      async getSession() { return { data: { session: { user: { id: profile.id, email: 'test@example.invalid' } } } }; }
    },
    from: table => new Query(table),
    functions: {
      async invoke() {
        return { data: { text: JSON.stringify({ session_note: 'Черновик по диктовке.', tolerance: 'good' }) } };
      }
    },
    sessions,
    patient,
    writes
  };
}
