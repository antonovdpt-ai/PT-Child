const DAY = 86_400_000;
const ru = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
const money = value => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format((Number(value) || 0) / 100);
const localInput = value => {
  const d = new Date(value);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const startOfWeek = date => {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};
const safeText = (esc, value) => esc(String(value || ''));

export async function renderCabinet({ app, sb, state, user, esc, renderPatients, renderProfile }) {
  let week = startOfWeek(new Date());
  let appointments = [];

  const patientName = id => state.patients.find(p => p.id === id)?.display_name || 'Без пациента';
  const load = async () => {
    const from = week.toISOString();
    const to = new Date(week.getTime() + 7 * DAY).toISOString();
    const { data, error } = await sb.from('appointments')
      .select('id,patient_id,starts_at,ends_at,kind,status,price_kopecks,paid_kopecks,note')
      .gte('starts_at', from).lt('starts_at', to).order('starts_at');
    if (error) throw error;
    appointments = data || [];
  };

  const draw = async () => {
    await load();
    const active = appointments.filter(x => x.kind === 'appointment');
    const planned = active.filter(x => x.status === 'planned').reduce((s, x) => s + x.price_kopecks, 0);
    const earned = active.filter(x => x.status === 'completed').reduce((s, x) => s + x.price_kopecks, 0);
    const paid = active.reduce((s, x) => s + x.paid_kopecks, 0);
    const days = Array.from({ length: 7 }, (_, i) => new Date(week.getTime() + i * DAY));
    const weekLabel = `${ru.format(days[0])} — ${ru.format(days[6])}`;
    app.innerHTML = `
      <div class="topline"><div><h1>Личный кабинет</h1><div class="muted tiny">Расписание и рабочие показатели</div></div><div class="actions"><button class="link" id="cabinetProfile" type="button">Профиль</button><button class="link" id="cabinetBack" type="button">← Пациенты</button></div></div>
      <div class="metric-grid">
        <div class="metric"><b>${money(planned)}</b><span>запланировано</span></div>
        <div class="metric"><b>${money(earned)}</b><span>заработано</span></div>
        <div class="metric"><b>${money(paid)}</b><span>оплачено</span></div>
        <div class="metric"><b>${money(Math.max(0, earned - paid))}</b><span>ожидается</span></div>
      </div>
      <div class="card"><div class="topline"><button class="btn small" id="prevWeek" type="button">←</button><b>${weekLabel}</b><button class="btn small" id="nextWeek" type="button">→</button></div>
        <div class="schedule-grid">${days.map(day => {
          const key = day.toDateString();
          const items = appointments.filter(x => new Date(x.starts_at).toDateString() === key);
          return `<section class="schedule-day"><b>${ru.format(day)}</b>${items.length ? items.map(x => appointmentHtml(x, patientName, esc)).join('') : '<div class="help">Свободно</div>'}</section>`;
        }).join('')}</div>
      </div>
      <div class="card"><h2>Добавить блок</h2>
        <form id="appointmentForm">
          <div class="row"><div><label>Начало</label><input name="starts_at" type="datetime-local" required value="${localInput(new Date())}"></div><div><label>Окончание</label><input name="ends_at" type="datetime-local" required value="${localInput(new Date(Date.now() + 3_600_000))}"></div></div>
          <label>Тип</label><select name="kind"><option value="appointment">Занятие</option><option value="break">Перерыв</option><option value="personal">Личное время</option></select>
          <label>Пациент</label><select name="patient_id"><option value="">Не выбран</option>${state.patients.map(p => `<option value="${p.id}">${safeText(esc, p.display_name)}</option>`).join('')}</select>
          <div class="row"><div><label>Стоимость, ₽</label><input name="price" type="number" min="0" step="1" value="0"></div><div><label>Оплачено, ₽</label><input name="paid" type="number" min="0" step="1" value="0"></div></div>
          <label>Комментарий</label><input name="note" maxlength="500" placeholder="Необязательно">
          <div class="actions"><button class="btn primary full" type="submit">Добавить в расписание</button></div><div class="save-status" id="appointmentStatus"></div>
        </form>
      </div>`;
    bind();
  };

  const appointmentHtml = (x, getPatient, escape) => {
    const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(x.starts_at));
    const label = x.kind === 'appointment' ? getPatient(x.patient_id) : x.kind === 'break' ? 'Перерыв' : 'Личное время';
    const status = ({ planned: 'запланировано', completed: 'проведено', cancelled: 'отменено', no_show: 'неявка' })[x.status];
    return `<div class="schedule-item"><div><b>${time} · ${safeText(escape, label)}</b><div class="help">${status}${x.kind === 'appointment' ? ` · ${money(x.price_kopecks)}` : ''}</div></div><div class="schedule-actions"><button class="link" data-status="completed" data-id="${x.id}">✓</button><button class="link" data-status="cancelled" data-id="${x.id}">Отм.</button><button class="link" data-delete="${x.id}">×</button></div></div>`;
  };

  const bind = () => {
    app.querySelector('#cabinetBack').onclick = renderPatients;
    app.querySelector('#cabinetProfile').onclick = renderProfile;
    app.querySelector('#prevWeek').onclick = () => { week = new Date(week.getTime() - 7 * DAY); draw().catch(showError); };
    app.querySelector('#nextWeek').onclick = () => { week = new Date(week.getTime() + 7 * DAY); draw().catch(showError); };
    app.querySelectorAll('[data-status]').forEach(button => button.onclick = async () => {
      const { error } = await sb.from('appointments').update({ status: button.dataset.status }).eq('id', button.dataset.id);
      if (error) return showError(error);
      draw().catch(showError);
    });
    app.querySelectorAll('[data-delete]').forEach(button => button.onclick = async () => {
      if (!window.confirm('Удалить этот блок из расписания?')) return;
      const { error } = await sb.from('appointments').delete().eq('id', button.dataset.delete);
      if (error) return showError(error);
      draw().catch(showError);
    });
    app.querySelector('#appointmentForm').onsubmit = async event => {
      event.preventDefault(); const fd = new FormData(event.currentTarget);
      const price = Math.round(Number(fd.get('price') || 0) * 100), paid = Math.round(Number(fd.get('paid') || 0) * 100);
      const status = app.querySelector('#appointmentStatus');
      if (paid > price) return showError(new Error('Оплата не может быть больше стоимости.'));
      const { error } = await sb.from('appointments').insert({
        therapist_id: user.id, patient_id: fd.get('patient_id') || null, starts_at: new Date(fd.get('starts_at')).toISOString(), ends_at: new Date(fd.get('ends_at')).toISOString(), kind: fd.get('kind'), price_kopecks: price, paid_kopecks: paid, note: String(fd.get('note') || '').trim() || null
      });
      if (error) return showError(error);
      status.textContent = 'Блок добавлен.'; draw().catch(showError);
    };
  };
  const showError = error => {
    const node = app.querySelector('#appointmentStatus');
    if (node) node.textContent = error.message || 'Не удалось обновить расписание.';
    else window.alert(error.message || 'Не удалось обновить расписание.');
  };
  await draw();
}
