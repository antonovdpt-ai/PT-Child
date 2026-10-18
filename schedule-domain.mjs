export const rub = value => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format((Number(value) || 0) / 100);
export function dayKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value), pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const localDate = value => new Date(`${dayKey(value)}T12:00:00`);
export function addDays(value, amount) { const d = new Date(value); d.setDate(d.getDate() + amount); return d; }
export function scheduleError(error) {
  const message = String(error?.message || 'Не удалось сохранить. Попробуй ещё раз.');
  if (error?.code === '23P01' || message.includes('appointments_no_active_overlap')) return 'Это время уже занято. Изменения не сохранены: выбери другое время или дни повторения.';
  if (message.includes('SCHEDULE_STALE')) return 'Запись или сумма долга уже изменились. Закрой окно и обнови расписание перед повторной попыткой.';
  if (['42703', 'PGRST202', 'PGRST204'].includes(error?.code)) return 'Для нового расписания нужно применить обновление базы 006. Затем нажми «Обновить».';
  return message;
}
export function periodBounds(value, mode) {
  const from = new Date(value); from.setHours(0, 0, 0, 0);
  if (mode === 'week') from.setDate(from.getDate() - (from.getDay() + 6) % 7);
  if (mode === 'month') from.setDate(1);
  if (mode === 'year') { from.setMonth(0, 1); }
  const to = new Date(from);
  if (mode === 'year') to.setFullYear(to.getFullYear() + 1);
  else if (mode === 'month') to.setMonth(to.getMonth() + 1);
  else to.setDate(to.getDate() + (mode === 'week' ? 7 : 1));
  return { from, to };
}
export function periodRows(rows, value, mode) {
  const { from, to } = periodBounds(value, mode);
  return rows.filter(r => new Date(r.starts_at) >= from && new Date(r.starts_at) < to);
}
export function totals(rows) {
  const visits = rows.filter(r => r.kind === 'appointment' && r.status !== 'cancelled' && r.status !== 'no_show');
  const completed = visits.filter(r => r.status === 'completed');
  return { count: visits.length, completed: completed.length, earned: completed.reduce((s, r) => s + r.price_kopecks, 0) };
}
export function debt(rows, patientId, excludeId = null) {
  if (!patientId) return 0;
  return rows.filter(r => r.patient_id === patientId && r.id !== excludeId && r.kind === 'appointment' && r.status === 'completed')
    .reduce((s, r) => s + Math.max(0, r.price_kopecks - r.paid_kopecks), 0);
}
export function hourSlot(date, hour, minute = 0) {
  if (!Number.isInteger(Number(hour)) || Number(hour) < 0 || Number(hour) > 23 || !Number.isInteger(Number(minute)) || Number(minute) < 0 || Number(minute) > 59) throw new Error('Проверь время: часы и минуты.');
  const d = new Date(`${dayKey(date)}T00:00:00`); d.setHours(Number(hour), Number(minute), 0, 0); return d;
}
export const timeLabel = value => { const d = new Date(value); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export function timeSlot(date, time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Введи время в формате ЧЧ:ММ, например 11:30.');
  const [hour, minute] = time.split(':'); return hourSlot(date, hour, minute);
}
export function scheduleConflicts(entries, appointments) {
  const active = r => ['planned', 'completed'].includes(r.status);
  const overlaps = (a, b) => new Date(a.starts_at) < new Date(b.ends_at) && new Date(a.ends_at) > new Date(b.starts_at);
  const replaced = new Set(entries.map(r => r.id).filter(Boolean));
  const existing = appointments.filter(r => active(r) && !replaced.has(r.id));
  return entries.some((entry, index) => active(entry) && (existing.some(row => overlaps(entry, row)) || entries.slice(0, index).some(row => active(row) && overlaps(entry, row))));
}
export function repeatDates(start, weekdays, weeks) {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12) throw new Error('Выбери от 1 до 12 недель.');
  const result = [new Date(start)];
  for (let i = 1; i < weeks * 7; i++) {
    const next = addDays(start, i);
    if (weekdays.includes(next.getDay())) result.push(next);
  }
  return result;
}
export function appointmentPayload(values, therapistId) {
  const start = hourSlot(values.date, values.hour, values.minute ?? 0);
  const price = Math.round(Number(values.price) * 100);
  if (!Number.isFinite(start.getTime()) || !Number.isInteger(Number(values.hour)) || Number(values.hour) < 0 || Number(values.hour) > 23) throw new Error('Проверь дату и час.');
  if (!Number.isSafeInteger(price) || price < 0 || price > 100000000) throw new Error('Проверь стоимость занятия.');
  const kind = values.kind || 'appointment';
  const end = new Date(start.getTime() + 3600000);
  const priorPaid = Number(values.previous_paid || 0);
  if (!Number.isSafeInteger(priorPaid) || priorPaid < 0 || priorPaid > price) throw new Error('Проверь ранее внесённую оплату.');
  return { therapist_id: therapistId, patient_id: kind === 'appointment' ? values.patient_id || null : null,
    initial_name: kind === 'appointment' && !values.patient_id ? String(values.initial_name || '').trim() || null : null,
    starts_at: start.toISOString(), ends_at: end.toISOString(), kind, status: values.status || 'planned',
    price_kopecks: kind === 'appointment' ? price : 0,
    paid_kopecks: kind === 'appointment' ? (values.paid ? price : priorPaid) : 0,
    note: String(values.note || '').trim() || null };
}
