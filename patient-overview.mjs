import {escapeHtml as esc} from './security-utils.mjs';
import {flowerIcon} from './patient-flower.mjs';

const dateLabel = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Дата не указана' : date.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
};
const statuses = {planned:'Запланировано',completed:'Проведено',cancelled:'Отменено',no_show:'Неявка'};
const safeRows = (rows,patientId) => (rows || []).filter(row => row.patient_id === patientId);
const latestReport = (patientId,reports,sessionReports) => [
  ...safeRows(reports,patientId).map(row=>({...row,kind:'initial'})),
  ...safeRows(sessionReports,patientId).map(row=>({...row,kind:'session'}))
].sort((a,b)=>(b.created_at || '').localeCompare(a.created_at || ''))[0];
const reportDetail = report => report ? `${report.kind === 'session' ? 'Отчёт занятия' : 'Первичный отчёт'} · Сохранённый текст и PDF` : 'Проверьте текст и отправьте PDF родителю.';
export function updateOverviewReport(root,{patientId,reports,sessionReports}) {
  if (!root?.isConnected) return;
  const report = latestReport(patientId,reports,sessionReports);
  const button = root.querySelector('[data-overview-report]');
  button.dataset.overviewReport = report?.id || '';
  button.dataset.reportKind = report?.kind || 'initial';
  button.dataset.reportSession = report?.session_id || '';
  button.querySelector('strong').textContent = report ? dateLabel(report.created_at) : 'Подготовить отчёт';
  button.querySelector('.overview-detail').textContent = reportDetail(report);
}
export function patientOverviewHtml({patientId,goals,sessions,reports,sessionReports}) {
  const active = safeRows(goals,patientId).filter(g => g.status === 'active');
  const recorded = safeRows(sessions,patientId).filter(s => s.dynamics_status || s.function_changes);
  const report = latestReport(patientId,reports,sessionReports);
  const card = (icon,label,title,detail,attrs,tone='mint') => `<button type="button" class="overview-card" ${attrs}>
    <span class="overview-icon ${tone}">${flowerIcon(icon)}</span><span class="overview-copy"><span class="overview-label">${label}</span><strong>${esc(title)}</strong><span class="overview-detail">${esc(detail)}</span></span><span class="overview-arrow">${flowerIcon('arrow')}</span></button>`;
  return `<section class="patient-overview" aria-labelledby="patientOverviewTitle"><header class="overview-heading"><div class="workspace-eyebrow">Рабочее пространство пациента</div><h2 id="patientOverviewTitle">Обзор</h2><p>Цели, ближайшее занятие и последние записи.</p></header><div class="overview-grid">
    ${card('goals','Текущие цели', active.length ? `Активных целей: ${active.length}` : 'Добавить первую цель', active.length ? active.slice(0,3).map(g=>g.title).join(' · ') : 'Определите приоритеты работы с ребёнком.',`data-overview-tab="goals" ${active.length ? '' : 'data-overview-add-goal'}`)}
    <div class="overview-appointment" aria-live="polite" aria-busy="true">${card('calendar','Следующее занятие','Загружаем расписание…','', 'disabled','blue')}</div>
    ${card('progress','Динамика',recorded.length ? `Записей с динамикой: ${recorded.length}` : 'Пока недостаточно данных',recorded.length ? `По записям специалиста: улучшений — ${recorded.filter(s=>s.dynamics_status==='improved').length}, без изменений — ${recorded.filter(s=>s.dynamics_status==='stable').length}, ухудшений — ${recorded.filter(s=>s.dynamics_status==='worse').length}.` : 'Добавьте наблюдения по результатам занятий.', 'data-overview-tab="progress"','violet')}
    ${card('report','Последний отчёт',report ? dateLabel(report.created_at) : 'Подготовить отчёт',reportDetail(report), `data-overview-report="${esc(report?.id || '')}" data-report-kind="${esc(report?.kind || 'initial')}" data-report-session="${esc(report?.session_id || '')}"`)}
    </div></section>`;
}

export async function mountPatientOverview({root,sb,patient,user,isCurrent,navigate,openReport,openAppointment,onSessionReports,getOverviewData}) {
  const current = () => root.isConnected && isCurrent();
  root.querySelectorAll('[data-overview-tab]').forEach(button => {button.onclick = () => current() && navigate(button.dataset.overviewTab,button.hasAttribute('data-overview-add-goal'));});
  const reportButton = root.querySelector('[data-overview-report]');
  const openLatestReport = () => current() && openReport(reportButton.dataset.overviewReport,reportButton.dataset.reportKind,reportButton.dataset.reportSession);
  reportButton.onclick = openLatestReport;
  async function refreshReports() {
    reportButton.disabled = true;reportButton.setAttribute('aria-busy','true');
    try {
      // Refresh on returning from the existing session editor, including newly saved drafts.
      const {data,error} = await sb.from('parent_session_reports').select('id,patient_id,therapist_id,session_id,created_at')
        .eq('patient_id',patient.id).eq('therapist_id',user.id).order('created_at',{ascending:false}).limit(1);
      if (!current()) return;
      if (error) throw error;
      onSessionReports?.((data || []).filter(row=>row.patient_id===patient.id && row.therapist_id===user.id));
      reportButton.onclick = openLatestReport;
    } catch {
      if (!current()) return;
      reportButton.querySelector('strong').textContent = 'Не удалось обновить отчёты';
      reportButton.querySelector('.overview-detail').textContent = 'Повторить загрузку списка отчётов';
      reportButton.onclick = refreshReports;
    } finally {if (current()) {reportButton.disabled = false;reportButton.setAttribute('aria-busy','false');}}
  }
  const appointment = root.querySelector('.overview-appointment');
  async function refresh() {
    if (!current()) return;
    appointment.setAttribute('aria-busy','true');
    try {
      const {data,error} = await sb.from('appointments').select('id,patient_id,therapist_id,starts_at,ends_at,kind,status,price_kopecks,paid_kopecks,note,initial_name,updated_at')
        .eq('patient_id',patient.id).eq('therapist_id',user.id).eq('kind','appointment').eq('status','planned')
        .gte('starts_at',new Date().toISOString()).order('starts_at',{ascending:true}).limit(1);
      if (!current()) return;
      if (error) throw error;
      const row = (data || []).find(r => r.patient_id === patient.id && r.therapist_id === user.id && r.kind === 'appointment' && r.status === 'planned' && new Date(r.starts_at) >= new Date());
      const duration = row ? Math.round((new Date(row.ends_at)-new Date(row.starts_at))/60000) : 0;
      appointment.innerHTML = `<button type="button" class="overview-card" data-overview-appointment><span class="overview-icon blue">${flowerIcon('calendar')}</span><span class="overview-copy"><span class="overview-label">Следующее занятие</span><strong>${row ? `${esc(dateLabel(row.starts_at))} · ${esc(new Date(row.starts_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}))}` : 'Запланировать занятие'}</strong><span class="overview-detail">${row ? `${esc(statuses[row.status])}${duration > 0 ? ` · ${duration} минут` : ''}` : 'Ближайших записей в расписании нет.'}</span></span><span class="overview-arrow">${flowerIcon('arrow')}</span></button>`;
      appointment.querySelector('button').onclick = async () => {
        if (!current()) return;
        const button = appointment.querySelector('button');button.disabled = true;
        try {await openAppointment(row,refresh);} catch {if (current()) {appointment.insertAdjacentHTML('beforeend','<p class="error" role="alert">Не удалось открыть запись. Попробуйте ещё раз.</p>');}}
        finally {if (current()) button.disabled = false;}
      };
    } catch {
      if (!current()) return;
      appointment.innerHTML = `<div class="overview-card overview-read-error"><span class="overview-icon blue">${flowerIcon('calendar')}</span><div class="overview-copy"><span class="overview-label">Следующее занятие</span><strong>Расписание недоступно</strong><button type="button" class="flower-tool" data-retry-appointment>Повторить загрузку</button></div></div>`;
      appointment.querySelector('button').onclick = refresh;
    } finally {if (current()) appointment.setAttribute('aria-busy','false');}
  }
  root.refreshOverview = async () => {
    if (!current()) return;
    const data = getOverviewData?.();
    if (data) {
      // Update summary text only; clinical forms and the PDF workspace stay mounted.
      const template = root.ownerDocument.createElement('template');
      template.innerHTML = patientOverviewHtml(data);
      for (const tab of ['goals','progress']) {
        const button = root.querySelector(`[data-overview-tab="${tab}"]`);
        const next = template.content.querySelector(`[data-overview-tab="${tab}"]`);
        button.querySelector('.overview-copy').innerHTML = next.querySelector('.overview-copy').innerHTML;
        button.toggleAttribute('data-overview-add-goal',next.hasAttribute('data-overview-add-goal'));
      }
      updateOverviewReport(root,data);
    }
    await Promise.all([refresh(),refreshReports()]);
  };
  await root.refreshOverview();
}
