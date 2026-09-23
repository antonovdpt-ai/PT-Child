import { rub, dayKey, hourSlot, debt, appointmentPayload, repeatDates, scheduleError } from './schedule-domain.mjs?v=2';

export function openScheduleEditor({ app, sb, user, patients, appointments, row, date, hour, esc, onSaved }) {
  const dialog = document.createElement('dialog'); dialog.className = 'schedule-dialog';
  let selected = row?.patient_id || '', initial = !!row && !row.patient_id, busy = false, contactVersion = 0, dirty = false;
  const originalPartial = row && row.paid_kopecks > 0 && row.paid_kopecks < row.price_kopecks ? row.paid_kopecks : 0;
  const start = row ? new Date(row.starts_at) : hourSlot(date, hour);
  const selectedName = () => patients.find(p => p.id === selected)?.display_name || 'Первичный приём';
  dialog.innerHTML = `<form class="schedule-editor"><div class="calendar-title"><h2>${row ? 'Редактировать запись' : 'Запись на приём'}</h2><button type="button" class="link" data-close aria-label="Закрыть">✕</button></div>
    <div class="row"><label>Дата<input name="date" type="date" required value="${dayKey(start)}"></label><label>Начало<select name="hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === start.getHours() ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></label></div>
    <label>Тип записи<select name="kind"><option value="appointment">Занятие</option><option value="break">Перерыв</option><option value="personal">Личное время</option></select></label>
    <div data-visit><label>Найти пациента<input type="search" data-search placeholder="Имя пациента" autocomplete="off"></label><div class="patient-picker" data-results role="group" aria-label="Выбор пациента"></div>
      <p class="calendar-selection" data-selection></p><label data-initial ${initial ? '' : 'hidden'}>Имя на первичном приёме<input name="initial_name" maxlength="120" value="${esc(row?.initial_name || '')}" placeholder="Можно заполнить позже"></label>
      <div class="calendar-contact" data-contact aria-live="polite"></div>
      <label>Стоимость занятия, ₽<input name="price" type="number" min="0" max="1000000" step="0.01" required value="${(row?.price_kopecks || 0) / 100}"></label>
      <label class="calendar-check" data-tariff><input name="save_tariff" type="checkbox" checked>Использовать эту стоимость для новых записей пациента</label>
      <label class="calendar-check"><input name="paid" type="checkbox" ${row?.price_kopecks > 0 && row.paid_kopecks === row.price_kopecks ? 'checked' : ''}>Занятие оплачено</label>
      ${originalPartial ? `<p class="help">Ранее внесено ${rub(originalPartial)}. Частичная оплата сохранится; галочка отмечает полную оплату.</p>` : ''}
      <div class="calendar-balance" data-balance aria-live="polite"></div>
    </div>
    <label>Статус<select name="status"><option value="planned">Запланировано</option><option value="completed">Проведено</option><option value="cancelled">Отменено</option><option value="no_show">Неявка</option></select></label>
    <label>Комментарий<textarea name="note" maxlength="500" rows="2">${esc(row?.note || '')}</textarea></label>
    ${!row ? `<details class="calendar-repeat"><summary>Повторять по дням недели</summary><p class="help">Запись на выбранную дату и повторы вперёд. Каждое занятие учитывается отдельно.</p><div class="calendar-weekdays">${[[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Вс']].map(([n, label]) => `<label><input type="checkbox" name="weekday" value="${n}">${label}</label>`).join('')}</div><label>На сколько недель<select name="weeks">${[1, 2, 3, 4, 6, 8, 12].map(n => `<option value="${n}" ${n === 4 ? 'selected' : ''}>${n}</option>`).join('')}</select></label><p class="help" data-repeat-preview></p></details>` : ''}
    <div class="error" data-error role="alert"></div><div class="calendar-editor-actions"><button class="btn primary" type="submit">${row ? 'Сохранить изменения' : 'Записать'}</button>${row ? '<button class="btn danger" type="button" data-delete>Удалить запись</button>' : ''}<button class="btn secondary" type="button" data-close>Отмена</button></div></form>`;
  app.append(dialog);
  const form = dialog.querySelector('form'), field = name => form.elements.namedItem(name);
  field('kind').value = row?.kind || 'appointment'; field('status').value = row?.status || 'planned';
  const close = () => { if (!busy && (!dirty || window.confirm('Закрыть без сохранения изменений?'))) { dialog.close(); dialog.remove(); } };
  dialog.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  dialog.oncancel = event => { event.preventDefault(); close(); };
  dialog.addEventListener('input', () => { dirty = true; });
  dialog.addEventListener('change', () => { dirty = true; });
  const showError = error => { dialog.querySelector('[data-error]').textContent = scheduleError(error); };
  async function operation(callback) {
    if (busy) return;
    busy = true; dialog.querySelector('[data-error]').textContent = '';
    const controls = [...form.querySelectorAll('button,input,select,textarea')].filter(c => !c.disabled); controls.forEach(c => c.disabled = true);
    try { await callback(); dirty = false; dialog.close(); dialog.remove(); await onSaved(); }
    catch (error) { showError(error); }
    finally { busy = false; controls.forEach(c => c.disabled = false); }
  }
  async function contacts() {
    const version = ++contactVersion, node = dialog.querySelector('[data-contact]');
    node.textContent = selected ? 'Загружаю контакты…' : 'Контакты можно будет добавить в карточку пациента.';
    if (!selected) return;
    const { data, error } = await sb.from('patient_contacts').select('full_name,relation,phone,is_primary').eq('patient_id', selected).eq('therapist_id', user.id).order('is_primary', { ascending: false });
    if (!dialog.isConnected || version !== contactVersion) return;
    node.innerHTML = error ? 'Не удалось загрузить контакты. Закрой и открой запись, чтобы повторить.' : !data.length ? 'В карточке пока нет контактов родителя.' : data.map(c => {
      const phone = String(c.phone || ''), href = phone.replace(/[^+\d]/g, '');
      return `<div><b>${esc(c.full_name || 'Родитель')}</b>${c.relation ? ` · ${esc(c.relation)}` : ''}${phone ? `<br>${href ? `<a href="tel:${href}">${esc(phone)}</a>` : esc(phone)}` : ''}</div>`;
    }).join('');
  }
  function choose(id) {
    if (row?.paid_kopecks > 0 && id !== row.patient_id) { showError(new Error('В этой записи уже есть оплата. Сначала разберись с оплатой, затем меняй пациента.')); return; }
    selected = id; initial = !id; dirty = true;
    field('price').value = (patients.find(p => p.id === selected)?.schedule_price_kopecks || 0) / 100;
    dialog.querySelector('[data-search]').value = ''; renderPicker(); updateSelection(); contacts(); updateBalance();
  }
  function renderPicker() {
    const query = dialog.querySelector('[data-search]').value.trim().toLocaleLowerCase('ru');
    const matches = patients.filter(p => String(p.display_name).toLocaleLowerCase('ru').includes(query)).sort((a, b) => a.display_name.localeCompare(b.display_name, 'ru'));
    const root = dialog.querySelector('[data-results]');
    root.innerHTML = `<button type="button" data-patient="" class="${initial ? 'selected' : ''}">+ Первичный приём</button>${matches.map(p => `<button type="button" data-patient="${p.id}" class="${p.id === selected ? 'selected' : ''}">${esc(p.display_name)}</button>`).join('')}${!matches.length ? '<p class="help">Пациент не найден. Можно записать на первичный приём.</p>' : ''}`;
    root.querySelectorAll('[data-patient]').forEach(b => b.onclick = () => choose(b.dataset.patient));
  }
  function updateSelection() {
    dialog.querySelector('[data-selection]').textContent = selected || initial ? `Выбрано: ${selectedName()}` : 'Выбери пациента или первичный приём.';
    dialog.querySelector('[data-initial]').hidden = !initial;
    dialog.querySelector('[data-tariff]').hidden = !selected;
    field('initial_name').disabled = !initial;
  }
  function updateBalance() {
    const price = Math.max(0, Math.round(Number(field('price').value || 0) * 100));
    const previous = debt(appointments, selected, row?.id);
    const unpaid = Math.max(0, price - (field('paid').checked ? price : originalPartial));
    const actionable = !['cancelled', 'no_show'].includes(field('status').value);
    const node = dialog.querySelector('[data-balance]');
    node.innerHTML = `<span>Долг за проведённые занятия: <b>${rub(previous)}</b></span><strong>К оплате${previous ? ' с долгом' : ''}: ${rub(previous + (actionable ? unpaid : 0))}</strong><small>Будущие, отменённые занятия и неявки долг не увеличивают. Стоимость следующего занятия остаётся прежней.</small>${row && previous > 0 && actionable ? '<button type="button" class="btn secondary" data-settle>Оплатить занятие и весь долг</button><small>Оплата будет отмечена в сохранённых записях. Несохранённые изменения сначала сохрани.</small>' : ''}`;
    const settle = node.querySelector('[data-settle]');
    if (settle) settle.onclick = () => {
      if (dirty) return showError(new Error('Сначала сохрани изменения записи, затем открой её для оплаты долга.'));
      const due = previous + row.price_kopecks - row.paid_kopecks;
      if (!window.confirm(`Подтвердить получение ${rub(due)} за занятие и долг?`)) return;
      operation(async () => { const { error } = await sb.rpc('settle_schedule_patient', { appointment_id: row.id, expected_due: due }); if (error) throw error; });
    };
  }
  function repeats() {
    if (row) return [hourSlot(field('date').value, field('hour').value)];
    const weekdays = [...form.querySelectorAll('[name="weekday"]:checked')].map(c => Number(c.value));
    const start = hourSlot(field('date').value, field('hour').value);
    return weekdays.length ? repeatDates(start, weekdays, Number(field('weeks').value)) : [start];
  }
  function updateRepeat() { const node = dialog.querySelector('[data-repeat-preview]'); if (node) node.textContent = `Всего записей: ${repeats().length}. Повторы создаются без отметки оплаты.`; }
  field('kind').onchange = () => { dialog.querySelector('[data-visit]').hidden = field('kind').value !== 'appointment'; };
  field('kind').onchange();
  field('price').oninput = updateBalance; field('paid').onchange = updateBalance; field('status').onchange = updateBalance;
  dialog.querySelector('[data-search]').oninput = renderPicker;
  if (!row) form.querySelectorAll('[name="weekday"],[name="weeks"],[name="date"],[name="hour"]').forEach(c => c.addEventListener('change', updateRepeat));
  form.onsubmit = event => {
    event.preventDefault();
    if (field('kind').value === 'appointment' && !selected && !initial) return showError(new Error('Выбери пациента или «Первичный приём».'));
    let entries;
    try {
      const values = { date: field('date').value, hour: field('hour').value, kind: field('kind').value, status: field('status').value,
        patient_id: selected, initial_name: field('initial_name').value, price: field('price').value, paid: field('paid').checked, previous_paid: originalPartial, note: field('note').value };
      const payload = appointmentPayload(values, user.id);
      if (payload.paid_kopecks > payload.price_kopecks) throw new Error('Стоимость меньше ранее внесённой оплаты. Проверь сумму.');
      entries = repeats().map((d, i) => ({ ...payload, starts_at: d.toISOString(), ends_at: new Date(d.getTime() + 3600000).toISOString(), ...(i ? { paid_kopecks: 0, status: 'planned' } : {}) }));
      if (row) {
        entries[0].id = row.id; entries[0].expected_updated_at = row.updated_at;
        if (dayKey(start) === values.date && start.getHours() === Number(values.hour)) {
          entries[0].starts_at = row.starts_at; entries[0].ends_at = row.ends_at;
        }
      }
    } catch (error) { return showError(error); }
    const saveTariff = !!selected && field('save_tariff').checked;
    operation(async () => { const { error } = await sb.rpc('save_schedule_entries', { entries, save_tariff: saveTariff }); if (error) throw error; });
  };
  const remove = dialog.querySelector('[data-delete]');
  if (remove) remove.onclick = () => {
    if (!window.confirm(`Удалить запись${row.paid_kopecks ? ' вместе с отметкой оплаты' : ''}? Это изменит итоги и долг пациента.`)) return;
    operation(async () => {
      const { data, error } = await sb.from('appointments').delete().eq('id', row.id).eq('therapist_id', user.id).eq('updated_at', row.updated_at).select('id');
      if (error) throw error; if (!data.length) throw new Error('SCHEDULE_STALE');
    });
  };
  renderPicker(); updateSelection(); contacts().catch(showError); updateBalance(); updateRepeat(); dialog.showModal();
  dialog.querySelector('[data-search]').focus();
}
