import {mountReportPdfExport} from './report-pdf-export.mjs?v=2';
import {escapeHtml as esc} from './security-utils.mjs';
import {publicationLabel} from './parent-domain.mjs';

const fields = [
  ['complaint', 'С чем обратились'], ['strengths', 'Что ребёнок сейчас умеет'],
  ['observations', 'На что мы обратили внимание'], ['goals', 'Над чем будем работать'],
  ['progress', 'Динамика'], ['recommendations', 'Рекомендации домой']
];
const editable = report => !report.published_at && ['draft', 'publication_error'].includes(report.publication_status || 'draft');
const hasContent = values => fields.some(([key]) => values[key]);
const cleanValues = values => Object.fromEntries(['therapist_name', ...fields.map(([key]) => key)].map(key => [key, String(values[key] || '').trim()]));

export function mountParentReportWorkspace(o) {
  const {root} = o, view = root.ownerDocument.defaultView;
  root.classList.add('parent-report-workspace');
  const patientId = o.patient.id, specialistId = o.specialist.id;
  const profile = {...o.profile};
  let disposed = false, token = 0, timer = null, saving = null, draft = null, savedText = '', pdfControl = null, pdfBusy = false, aiBusy = false, leaving = false;
  let reports = (o.reports || []).filter(r => r.patient_id === patientId && r.therapist_id === specialistId).map(r => ({...r}));
  const current = () => !disposed && root.isConnected && o.patient.id === patientId && o.specialist.id === specialistId && o.patient.therapist_id === specialistId && o.isCurrent?.() === true;
  const editorCurrent = captured => current() && captured === token;
  root.innerHTML = `<section class="card parent-report-launch">
    <div class="parent-report-launch-copy"><div class="workspace-eyebrow">Обратная связь</div><h3>Отчёт для родителя</h3>
    <p>Подготовьте понятный отчёт по результатам оценки. Вы сможете проверить текст, сохранить PDF и отправить его родителю.</p></div>
    <button type="button" class="btn primary parent-report-launch-button" data-start-report>✨ Подготовить отчёт</button>
  </section>
  <section class="card parent-report-editor" data-report-editor hidden>
    <header class="parent-report-editor-heading"><div><div class="workspace-eyebrow">Отчёт для родителя</div>
    <h3 data-editor-heading>Проверьте текст отчёта</h3><p data-editor-help>ИИ готовит черновик. Проверьте и отредактируйте его перед формированием PDF.</p></div></header>
    <div data-report-fields class="parent-report-fields">
      <label>Специалист<input name="therapist_name" type="text" autocomplete="name"></label>
      ${fields.map(([key, label]) => `<label>${label}<textarea name="${key}" rows="${key === 'recommendations' ? 5 : 3}"></textarea></label>`).join('')}
    </div>
    <p data-save-status class="report-save-status" role="status" aria-live="polite"></p>
    <div data-draft-error class="report-draft-error" hidden><p>Не удалось подготовить отчёт. Попробуйте ещё раз или заполните текст самостоятельно.</p><button type="button" class="btn" data-retry-draft>Попробовать ещё раз</button></div>
    <div data-initial-pdf></div>
    <div class="report-editor-secondary"><button type="button" class="link" data-close-report>Закрыть</button></div>
  </section>
  <section class="card parent-report-history"><details><summary class="parent-report-history-summary">История отчётов <span data-history-count></span></summary><div data-report-history></div></details></section>`;
  const find = selector => root.querySelector(selector);
  const editor = find('[data-report-editor]'), launch = find('.parent-report-launch'), fieldBox = find('[data-report-fields]'), pdfRoot = find('[data-initial-pdf]'), saveStatus = find('[data-save-status]');
  function phase(value) { if (current()) root.dataset.state = value; }
  function status(message, state = '') { if (current()) { saveStatus.textContent = message; saveStatus.dataset.state = state; } }
  function read() { return cleanValues(Object.fromEntries([...root.querySelectorAll('[name]')].map(field => [field.name, field.value]))); }
  function fill(values, readOnly) {
    for (const field of fieldBox.querySelectorAll('[name]')) { field.value = typeof values?.[field.name] === 'string' ? values[field.name] : ''; field.readOnly = readOnly; }
  }
  function enableFields() { for (const field of fieldBox.querySelectorAll('[name]')) field.disabled = aiBusy || pdfBusy || leaving; }
  function updateHistory() {
    if (!current()) return;
    find('[data-history-count]').textContent = reports.length ? `(${reports.length})` : '';
    find('[data-report-history]').innerHTML = reports.length ? reports.map(report => `<article class="item parent-report-history-item">
      <div class="item-title">Первичный отчёт · ${esc(report.created_at ? new Date(report.created_at).toLocaleDateString('ru-RU') : 'Сегодня')}</div>
      <div class="item-sub">${esc(publicationLabel(report.publication_status || 'draft'))} · ${esc(report.therapist_name || '')}</div>
      <button type="button" class="link report-history-action" data-open-parent-report="${esc(report.id)}">Открыть</button>
      ${editable(report) ? `<button type="button" class="link report-history-action report-history-delete" data-delete-parent-report="${esc(report.id)}">Удалить</button>` : ''}
    </article>`).join('') : '<div class="empty">Сохранённых отчётов пока нет.</div>';
    find('[data-report-history]').querySelectorAll('[data-open-parent-report]').forEach(button => { button.onclick = async () => {
      const reportId = button.dataset.openParentReport;
      if (!current() || !reports.some(report => report.id === reportId)) return;
      if (draft && editable(draft) && (draft.id || hasContent(read())) && JSON.stringify(read()) !== savedText && !await flush()) return;
      if (!current()) return;
      const next = reports.find(report => report.id === reportId);
      if (!next) return;
      retireEditor(); draft = {...next};
      const frozen = !!draft.published_at || ['published', 'archived'].includes(draft.publication_status);
      fill(frozen ? draft.published_snapshot : draft, !editable(draft));
      savedText = JSON.stringify(read());
      showEditor(); phase('READY_TO_GENERATE');
      find('[data-editor-help]').textContent = frozen ? 'Сохранённая версия отчёта. PDF можно отправить родителю без аккаунта Fizira.' : 'Проверьте текст перед формированием PDF. Изменения сохраняются автоматически.';
      status(frozen ? 'Опубликованный отчёт доступен только для чтения.' : '✓ Сохранено');
      if (draft.publication_status === 'publishing') { status('Отчёт ещё публикуется. Откройте его повторно после завершения.'); pdfRoot.hidden = true; }
      else mountPdf();
    }; });
    find('[data-report-history]').querySelectorAll('[data-delete-parent-report]').forEach(button => { button.onclick = async () => {
      const report = reports.find(row => row.id === button.dataset.deleteParentReport);
      if (!current() || !report || !editable(report) || saving || !view.confirm('Удалить этот отчёт? Это действие нельзя отменить.')) return;
      button.disabled = true;
      try {
        const result = await o.sb.from('parent_reports').delete().eq('id', report.id).eq('patient_id', patientId).eq('therapist_id', specialistId).eq('publication_status', report.publication_status || 'draft').select('id').single();
        if (!current()) return;
        if (result.error) throw new Error();
        reports = reports.filter(row => row.id !== report.id); o.onDeleted?.(report.id);
        if (draft?.id === report.id) { retireEditor(); draft = null; editor.hidden = true; launch.hidden = false; phase('EMPTY'); }
        updateHistory();
      } catch { if (current()) { button.disabled = false; button.textContent = 'Не удалось удалить. Повторить'; } }
    }; });
  }
  function retireEditor() {
    token++; view.clearTimeout(timer); timer = null; saving = null; pdfControl?.dispose(); pdfControl = null; pdfRoot.replaceChildren();
    aiBusy = pdfBusy = false; enableFields(); find('[data-draft-error]').hidden = true;
  }
  function showEditor() { editor.hidden = false; launch.hidden = true; fieldBox.hidden = false; editor.scrollIntoView({behavior:'smooth', block:'start'}); }
  function mountPdf() {
    const captured = token;
    pdfControl?.dispose();
    pdfControl = mountReportPdfExport({root:pdfRoot, sb:o.sb, reportId:draft?.id, reportKind:'initial', isCurrent:() => editorCurrent(captured) && !editor.hidden,
      beforePrepare:async () => {
        if (!editable(draft)) return draft?.id;
        if (!hasContent(read())) { status('Добавьте текст отчёта перед формированием PDF.', 'error'); return null; }
        return flush();
      },
      onState(value) { if (!editorCurrent(captured)) return; pdfBusy = value === 'GENERATING_PDF'; enableFields(); phase(value); },
      onReady() { if (editorCurrent(captured)) { fieldBox.hidden = true; find('[data-draft-error]').hidden = true; find('[data-editor-heading]').textContent = 'Отчёт для родителя'; find('[data-editor-help]').textContent = 'Проверьте документ и передайте родителю. Аккаунт Fizira для получения PDF не требуется.'; editor.scrollIntoView({behavior:'smooth',block:'start'}); } },
      ...(editable(draft) ? {onEdit() { if (editorCurrent(captured)) { fieldBox.hidden = false; find('[data-editor-heading]').textContent = 'Проверьте текст отчёта'; find('[data-editor-help]').textContent = 'Изменения сохраняются автоматически. После проверки сформируйте PDF заново.'; phase('EDITING'); } }} : {})
    });
    pdfRoot.hidden = aiBusy || (editable(draft) && !hasContent(read()));
  }
  function schedule() {
    view.clearTimeout(timer);
    const captured = token;
    timer = view.setTimeout(() => { timer = null; if (editorCurrent(captured)) void flush(); }, 650);
  }
  async function write(values, captured) {
    if (!editorCurrent(captured) || !editable(draft)) return false;
    const target = {...draft};
    const payload = {patient_id:patientId, therapist_id:specialistId, ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value || null])),
      therapist_profession:profile.profession || null, therapist_organization:profile.organization || null, therapist_phone:profile.phone || null, therapist_logo_path:profile.logo_path || null, updated_at:new Date().toISOString()};
    status('Сохраняем…', 'saving'); if (!pdfBusy) phase('SAVING');
    try {
      let query;
      if (target.id) {
        query = o.sb.from('parent_reports').update(payload).eq('id', target.id).eq('patient_id', patientId).eq('therapist_id', specialistId).eq('publication_status', target.publication_status || 'draft');
        if (target.updated_at) query = query.eq('updated_at', target.updated_at);
      } else query = o.sb.from('parent_reports').insert(payload);
      const result = await query.select('id,created_at,updated_at,publication_status,published_at').single();
      if (!editorCurrent(captured)) return false;
      if (result.error || !result.data?.id) throw new Error();
      draft = {...target, ...payload, ...result.data, publication_status:result.data.publication_status || target.publication_status || 'draft'};
      savedText = JSON.stringify(values);
      const index = reports.findIndex(row => row.id === draft.id);
      if (index < 0) reports.unshift({...draft}); else reports[index] = {...draft};
      o.onSaved?.({...draft}); updateHistory();
      if (JSON.stringify(read()) === savedText) { status('✓ Сохранено', 'saved'); if (!pdfBusy) phase('READY_TO_GENERATE'); }
      return true;
    } catch {
      if (editorCurrent(captured)) { status('Изменения пока не сохранены. Нажмите «Сформировать PDF», чтобы повторить сохранение.', 'error'); phase('ERROR'); }
      return false;
    }
  }
  async function flush() {
    const captured = token; view.clearTimeout(timer); timer = null;
    while (editorCurrent(captured) && draft && editable(draft)) {
      if (saving) { const success = await saving; if (!success) return null; continue; }
      const values = read();
      if (!draft.id && !hasContent(values)) return null;
      if (draft.id && JSON.stringify(values) === savedText) return draft.id;
      const operation = write(values, captured);
      saving = operation;
      const success = await operation;
      if (saving === operation) saving = null;
      if (!success) return null;
    }
    return null;
  }
  async function generateDraft() {
    const captured = token;
    if (!editorCurrent(captured) || !draft || aiBusy) return;
    const original = read(); aiBusy = true; phase('GENERATING_DRAFT'); status('Готовим отчёт…'); enableFields(); pdfRoot.hidden = true; find('[data-draft-error]').hidden = true;
    try {
      const result = await o.prepareDraft();
      if (!editorCurrent(captured)) return;
      if (!result || typeof result !== 'object' || Array.isArray(result) || fields.some(([key]) => result[key] != null && typeof result[key] !== 'string') || !hasContent(cleanValues(result))) throw new Error();
      // A retry fills empty sections, preserving any text already entered by the specialist.
      for (const [key] of fields) { const field = find(`[name="${key}"]`); if (!original[key] && !field.value.trim()) field.value = result[key] || ''; }
      status('Черновик готов. Проверьте текст.'); phase('EDITING'); schedule();
    } catch { if (editorCurrent(captured)) { find('[data-draft-error]').hidden = false; status('Не удалось подготовить отчёт.', 'error'); phase('ERROR'); } }
    finally { if (editorCurrent(captured)) { aiBusy = false; enableFields(); pdfRoot.hidden = !hasContent(read()); } }
  }
  find('[data-start-report]').onclick = async () => {
    if (!current()) return;
    retireEditor(); draft = {publication_status:'draft'}; savedText = '';
    fill({therapist_name:profile.full_name || o.specialist.full_name || ''}, false);
    find('[data-editor-help]').textContent = 'ИИ готовит черновик. Проверьте и отредактируйте его перед формированием PDF.';
    find('[data-editor-heading]').textContent = 'Проверьте текст отчёта';
    showEditor(); mountPdf(); await generateDraft();
  };
  find('[data-retry-draft]').onclick = generateDraft;
  fieldBox.addEventListener('input', () => {
    if (!current() || !draft || !editable(draft) || editor.hidden) return;
    pdfControl?.invalidate(''); status('Изменения сохраняются…'); if (!pdfBusy) phase('EDITING');
    pdfRoot.hidden = !hasContent(read()); schedule();
  });
  find('[data-close-report]').onclick = async () => {
    if (!current()) return;
    if (draft && editable(draft) && (draft.id || hasContent(read())) && JSON.stringify(read()) !== savedText && !await flush()) return;
    if (!current()) return;
    retireEditor(); draft = null; editor.hidden = true; launch.hidden = false; phase('EMPTY');
  };
  const observer = new view.MutationObserver(() => { if (!root.isConnected) dispose(); });
  observer.observe(root.ownerDocument.body, {childList:true, subtree:true});
  async function beforeLeave() {
    if (!current()) return false;
    if (!draft || !editable(draft) || (!draft.id && !hasContent(read())) || (draft.id && JSON.stringify(read()) === savedText && !saving)) return true;
    const captured = token;
    leaving = true; enableFields();
    try { return !!await flush() && editorCurrent(captured); }
    finally { leaving = false; if (editorCurrent(captured)) enableFields(); }
  }
  function dispose() { if (disposed) return; disposed = true; retireEditor(); observer.disconnect(); if (root.parentReportController === controller) delete root.parentReportController; }
  const controller = {flush, beforeLeave, dispose};
  root.parentReportController = controller;
  updateHistory(); phase('EMPTY');
  return controller;
}

// Same-account navigation awaits the last edit; failed saves keep the current editor.
export async function leaveParentReportWorkspace(app) {
  const root = app.querySelector('.parent-report-workspace'), controller = root?.parentReportController;
  if (!controller) return true;
  if (!await controller.beforeLeave() || !root.isConnected || root.parentReportController !== controller) return false;
  controller.dispose();
  return true;
}
