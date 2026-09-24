import { rub, dayKey, localDate, addDays, periodBounds, periodRows, totals, scheduleError } from './schedule-domain.mjs?v=2';
import { openScheduleEditor } from './schedule-editor.js?v=3';

const dateLabel = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long' });
const statuses = { planned: 'Запланировано', completed: 'Проведено', cancelled: 'Отменено', no_show: 'Неявка' };
const modes = { day: 'День', week: 'Неделя', month: 'Месяц', year: 'Год' };

export async function renderCabinet({ app, sb, state, user, esc, renderPatients, renderProfile }) {
  let appointments = [], patients = [], date = new Date(), mode = 'week', loaded = false, loading = false;
  let page, notice = '', metricsMode = 'week';
  const expanded = new Set([dayKey(date)]), hours = new Map();
  const safe = value => esc(String(value ?? ''));
  const name = row => row.kind === 'break' ? 'Перерыв' : row.kind === 'personal' ? 'Личное время'
    : patients.find(p => p.id === row.patient_id)?.display_name || row.initial_name || 'Первичный приём';
  const summary = rows => {
    const t = totals(rows);
    return `<span>Занятий: <b>${t.count}</b> · проведено: <b>${t.completed}</b></span><span>Заработано: <b>${rub(t.earned)}</b></span>`;
  };
  function navigation(active) {
    return `<div class="cabinet-head"><div><h1>Личный кабинет</h1><button class="link" data-nav="patients">← Пациенты</button></div>
      <nav class="cabinet-tabs" aria-label="Личный кабинет"><button data-nav="schedule" class="${active === 'schedule' ? 'active' : ''}" ${active === 'schedule' ? 'aria-current="page"' : ''}>Расписание</button><button data-nav="profile" class="${active === 'profile' ? 'active' : ''}" ${active === 'profile' ? 'aria-current="page"' : ''}>Профиль</button></nav></div>`;
  }
  function bindNav(root) {
    root.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => {
      if (b.dataset.nav === 'patients') return renderPatients();
      if (b.dataset.nav === 'profile') {
        renderProfile();
        const nav = document.createElement('div'); nav.className = 'cabinet-profile-nav'; nav.innerHTML = navigation('profile');
        app.prepend(nav); bindNav(nav); return;
      }
      showSchedule();
    });
  }
  async function allRows(table, fields) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await sb.from(table).select(fields).eq('therapist_id', user.id).order('id').range(offset, offset + 499);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 500) return rows;
    }
  }
  async function refresh() {
    if (loading) return;
    loading = true; const owner = page;
    if (page?.isConnected) page.querySelector('[data-refresh]')?.setAttribute('disabled', '');
    try {
      const [a, p] = await Promise.all([
        allRows('appointments', 'id,patient_id,starts_at,ends_at,kind,status,price_kopecks,paid_kopecks,note,initial_name,updated_at'),
        allRows('patients', 'id,display_name,schedule_price_kopecks')
      ]);
      appointments = a.sort((x, y) => x.starts_at.localeCompare(y.starts_at)); patients = p; loaded = true; notice = '';
    } catch (error) { notice = scheduleError(error); }
    finally { loading = false; if (owner?.isConnected) draw(); }
  }
  function showSchedule() {
    app.innerHTML = '<div class="cabinet-page"></div>'; page = app.firstElementChild; draw(); refresh();
  }
  function dayHtml(day) {
    const key = dayKey(day), rows = periodRows(appointments, day, 'day');
    return `<details class="calendar-day" data-day="${key}" ${expanded.has(key) || mode === 'day' ? 'open' : ''}>
      <summary><span><b>${safe(dateLabel.format(day))}</b>${key === dayKey(new Date()) ? '<span class="calendar-today">Сегодня</span>' : ''}</span><span>${totals(rows).count} занятий</span></summary>
      <div class="calendar-day-body" data-body="${key}"></div></details>`;
  }
  function fillDay(details) {
    const key = details.dataset.day, day = localDate(key), rows = periodRows(appointments, day, 'day');
    const range = hours.get(key) || [8, 20];
    const activeHours = rows.map(r => new Date(r.starts_at).getHours());
    const first = Math.min(range[0], ...activeHours), last = Math.max(range[1], ...activeHours);
    const options = chosen => Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === chosen ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('');
    const body = details.querySelector('[data-body]');
    body.innerHTML = `<div class="calendar-hours"><span>Часы рабочего дня</span><label>С <select data-hour-from aria-label="Первый час рабочего дня">${options(range[0])}</select></label><label>По <select data-hour-to aria-label="Последний час рабочего дня">${options(range[1])}</select></label></div>
      <div class="calendar-slots">${Array.from({ length: last - first + 1 }, (_, i) => {
        const h = i + first, at = new Date(`${key}T${String(h).padStart(2, '0')}:00:00`);
        const items = rows.filter(r => new Date(r.starts_at).getHours() === h);
        const blocked = appointments.some(r => ['planned', 'completed'].includes(r.status) && new Date(r.starts_at) <= at && new Date(r.ends_at) > at);
        return `<div class="calendar-slot"><span class="calendar-time">${String(h).padStart(2, '0')}:00</span><div>${items.map(r => `<button class="calendar-entry ${safe(r.status)}" data-edit="${r.id}"><span><strong>${safe(name(r))}</strong>${!r.patient_id && r.kind === 'appointment' ? '<small>Первичный приём</small>' : ''}<small>${statuses[r.status]}${r.kind === 'appointment' ? ` · ${rub(r.price_kopecks)}` : ''}${new Date(r.starts_at).getMinutes() ? ` · начало ${new Date(r.starts_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}</small></span>${r.kind === 'appointment' ? `<span class="calendar-paid">${r.price_kopecks > 0 && r.paid_kopecks >= r.price_kopecks ? '✓ Оплачено' : 'Без оплаты'}</span>` : ''}</button>`).join('')}
          ${!blocked ? `<button class="calendar-empty" data-slot="${h}">+ Записать пациента <span>или первичный приём</span></button>` : !items.length ? '<span class="help">Занято предыдущей записью</span>' : ''}</div></div>`;
      }).join('')}</div><div class="calendar-total">${summary(rows)}</div>`;
    body.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => edit(null, key, Number(b.dataset.slot)));
    body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(appointments.find(r => r.id === b.dataset.edit)));
    const changeHours = () => {
      const from = Number(body.querySelector('[data-hour-from]').value), to = Number(body.querySelector('[data-hour-to]').value);
      if (from > to) { window.alert('Первый час должен быть раньше последнего.'); return fillDay(details); }
      hours.set(key, [from, to]);
      // Display preferences only: no patient data is stored in the browser.
      try { localStorage.setItem(`fizira-hours:${user.id}`, JSON.stringify([...hours])); } catch {}
      fillDay(details);
    };
    body.querySelector('[data-hour-from]').onchange = changeHours;
    body.querySelector('[data-hour-to]').onchange = changeHours;
  }
  function edit(row, key = dayKey(new Date()), hour = new Date().getHours()) {
    openScheduleEditor({ app: page, sb, user, patients, appointments, row, date: key, hour, esc: safe, onSaved: refresh });
  }
  function draw() {
    if (!page?.isConnected) return;
    const { from, to } = periodBounds(date, mode), rows = periodRows(appointments, date, mode);
    const days = []; for (let d = new Date(from); d < to; d = addDays(d, 1)) days.push(d);
    const title = mode === 'year' ? String(from.getFullYear()) : mode === 'month' ? `${monthLabel.format(from)} ${from.getFullYear()}` : mode === 'day' ? dateLabel.format(from) : `${dateLabel.format(from)} — ${dateLabel.format(addDays(to, -1))}`;
    page.innerHTML = `${navigation('schedule')}<div class="calendar-toolbar"><div class="cabinet-tabs" aria-label="Период расписания">${Object.entries(modes).map(([k, v]) => `<button data-mode="${k}" class="${mode === k ? 'active' : ''}" aria-pressed="${mode === k}">${v}</button>`).join('')}</div>
      <div class="calendar-controls"><button class="link" data-step="-1" aria-label="Предыдущий период">←</button><input type="date" data-date value="${dayKey(date)}" aria-label="Дата расписания"><button class="link" data-step="1" aria-label="Следующий период">→</button><button class="link" data-today>Сегодня</button><button class="link" data-refresh ${loading ? 'disabled' : ''}>Обновить</button></div></div>
      <div class="calendar-title"><h2>${safe(title)}</h2>${mode === 'week' && loaded ? '<button class="btn secondary" data-copy>Скопировать на следующую неделю</button>' : ''}</div>
      <p class="help">Открой день и нажми на свободный час или существующую запись. Время — по часовому поясу устройства.</p>
      <div class="error" role="alert">${safe(notice)}</div>
      ${loaded ? (mode === 'year' ? Array.from({ length: 12 }, (_, i) => {
        const month = new Date(from.getFullYear(), i, 1, 12), monthRows = periodRows(appointments, month, 'month');
        return `<details class="calendar-month"><summary><b>${safe(monthLabel.format(month))}</b><span>${totals(monthRows).count} занятий · ${rub(totals(monthRows).earned)}</span></summary>${days.filter(d => d.getMonth() === i).map(dayHtml).join('')}<div class="calendar-total">${summary(monthRows)}</div></details>`;
      }).join('') : days.map(dayHtml).join('')) : `<div class="card">${notice ? 'Расписание пока недоступно.' : 'Загружаю расписание…'}</div>`}
      ${loaded ? `<div class="calendar-total calendar-period-total">${summary(rows)}</div><section class="card calendar-metrics"><h2>Рабочие показатели</h2><label>Интервал <select data-metrics>${Object.entries(modes).map(([k, v]) => `<option value="${k}" ${metricsMode === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label><div data-metric-values></div><p class="help">Заработано — стоимость проведённых занятий. Отметки оплаты учитывают долг отдельно.</p></section>` : ''}`;
    bindNav(page);
    page.querySelector('[data-refresh]').onclick = refresh;
    page.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; metricsMode = mode; draw(); });
    page.querySelector('[data-date]').onchange = e => { if (e.target.value) { date = localDate(e.target.value); expanded.add(dayKey(date)); draw(); } };
    page.querySelector('[data-today]').onclick = () => { date = new Date(); expanded.add(dayKey(date)); draw(); };
    page.querySelectorAll('[data-step]').forEach(b => b.onclick = () => {
      const step = Number(b.dataset.step), next = periodBounds(date, mode).from;
      if (mode === 'year') next.setFullYear(next.getFullYear() + step);
      else if (mode === 'month') next.setMonth(next.getMonth() + step);
      else next.setDate(next.getDate() + step * (mode === 'week' ? 7 : 1));
      date = next; draw();
    });
    page.querySelectorAll('[data-day]').forEach(details => {
      if (details.open) fillDay(details);
      details.ontoggle = () => { if (details.open) { expanded.add(details.dataset.day); fillDay(details); } else expanded.delete(details.dataset.day); };
    });
    if (loaded) {
      drawMetrics(); page.querySelector('[data-metrics]').onchange = e => { metricsMode = e.target.value; drawMetrics(); };
      const copy = page.querySelector('[data-copy]'); if (copy) copy.onclick = () => copyWeek(copy);
    }
  }
  function drawMetrics() {
    const rows = periodRows(appointments, date, metricsMode), { from, to } = periodBounds(date, metricsMode), t = totals(rows);
    const prices = rows.filter(r => r.kind === 'appointment' && !['cancelled', 'no_show'].includes(r.status)).map(r => r.price_kopecks);
    const price = !prices.length ? '—' : Math.min(...prices) === Math.max(...prices) ? rub(prices[0]) : `${rub(Math.min(...prices))} – ${rub(Math.max(...prices))}`;
    page.querySelector('[data-metric-values]').innerHTML = `<p class="help">${from.toLocaleDateString('ru-RU')} — ${addDays(to, -1).toLocaleDateString('ru-RU')}</p><div class="calendar-metric-grid"><div><span>Стоимость занятия</span><strong>${price}</strong></div><div><span>Заработано</span><strong>${rub(t.earned)}</strong></div></div><p>Занятий: ${t.count} · проведено: ${t.completed}</p>`;
  }
  async function copyWeek(button) {
    const source = periodRows(appointments, date, 'week').filter(r => ['planned', 'completed'].includes(r.status));
    if (!source.length) return window.alert('В этой неделе нет записей для копирования.');
    if (!window.confirm(`Скопировать ${source.length} записей на следующую неделю? Стоимость сохранится, отметки оплаты и проведения будут сброшены. При занятом времени ничего не скопируется.`)) return;
    button.disabled = true;
    try {
      const entries = source.map(r => ({ ...r, id: undefined, updated_at: undefined, starts_at: addDays(r.starts_at, 7).toISOString(), ends_at: addDays(r.ends_at, 7).toISOString(), status: 'planned', paid_kopecks: 0 }));
      const { error } = await sb.rpc('save_schedule_entries', { entries, save_tariff: false }); if (error) throw error;
      date = addDays(date, 7); await refresh();
    } catch (error) { notice = scheduleError(error); draw(); }
    finally { button.disabled = false; }
  }
  try {
    const stored = JSON.parse(localStorage.getItem(`fizira-hours:${user.id}`) || '[]');
    if (Array.isArray(stored)) for (const [key, range] of stored) if (/^\d{4}-\d{2}-\d{2}$/.test(key) && Array.isArray(range) && range.length === 2 && range.every(n => Number.isInteger(n) && n >= 0 && n <= 23) && range[0] <= range[1]) hours.set(key, range);
  } catch {}
  showSchedule();
}
