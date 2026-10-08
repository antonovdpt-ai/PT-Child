// File export is independent of Parent Cabinet publication and permissions.
import {mountReportPdfPreview} from './report-pdf-preview.mjs?v=1';
const views = new WeakMap();
const MAX_PDF_BYTES = 10 * 1024 * 1024;

export function mountReportPdfExport(o) {
  const {root} = o, view = root.ownerDocument.defaultView;
  const generation = (views.get(root) || 0) + 1;
  views.set(root, generation);
  let file = null, busy = false, revision = 0, previewUrl = null, preview = null, disposed = false;
  root.innerHTML = `<section class="report-pdf-export">
    <button type="button" class="btn primary full" data-prepare-pdf>${o.beforePrepare ? 'Готово — сформировать PDF' : 'Сформировать PDF'}</button>
    <div class="report-pdf-ready" data-pdf-ready hidden>
      <h3>✓ Отчёт готов</h3>
      <div data-pdf-preview class="report-pdf-preview"><canvas role="img" aria-label="Предпросмотр отчёта Fizira" hidden></canvas><p data-pdf-preview-note role="status" aria-live="polite"></p></div>
      <a data-open-pdf class="link report-preview-link" target="_blank" rel="noopener">Открыть весь PDF в отдельном окне</a>
    </div>
    <div class="report-pdf-ready-actions">
      <button type="button" class="btn primary" data-share-pdf hidden disabled>Поделиться PDF</button>
      <button type="button" class="btn" data-download-pdf hidden disabled>Скачать</button>
      <button type="button" class="btn" data-edit-pdf hidden>Редактировать</button>
    </div>
    <p data-pdf-status role="status" aria-live="polite"></p>
  </section>`;
  const section = root.firstElementChild;
  const current = () => !disposed && root.isConnected && root.firstElementChild === section && views.get(root) === generation && o.isCurrent?.() === true;
  const find = selector => section.querySelector(selector);
  const prepare = find('[data-prepare-pdf]'), download = find('[data-download-pdf]'), share = find('[data-share-pdf]'), edit = find('[data-edit-pdf]'), status = find('[data-pdf-status]');
  const label = prepare.textContent;
  const message = text => { if (current()) status.textContent = text; };
  const state = (value, text) => { if (current()) { section.dataset.state = value; o.onState?.(value); if (text) message(text); } };
  function clearFile() {
    file = null;
    preview?.dispose(); preview = null;
    if (previewUrl) view.URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    find('[data-open-pdf]')?.removeAttribute('href');
  }
  function controls() {
    if (!current()) return;
    prepare.hidden = !!file;
    prepare.disabled = busy;
    prepare.textContent = busy && !file ? 'Формируем PDF…' : label;
    find('[data-pdf-ready]').hidden = !file;
    download.hidden = share.hidden = !file;
    download.disabled = share.disabled = busy || !file;
    edit.hidden = !file || !o.onEdit;
    edit.disabled = busy;
  }
  function invalidate(text = 'Отчёт изменён. Сформируйте PDF после проверки текста.') {
    if (!current()) return;
    revision++;
    clearFile();
    state('READY_TO_GENERATE', text);
    controls();
  }
  function saveFile() {
    if (!current() || !file) return false;
    const url = view.URL.createObjectURL(file), anchor = root.ownerDocument.createElement('a');
    anchor.href = url; anchor.download = file.name; anchor.target = '_blank'; anchor.rel = 'noopener';
    root.ownerDocument.body.append(anchor); anchor.click(); anchor.remove();
    view.setTimeout(() => view.URL.revokeObjectURL(url), 60000);
    return true;
  }
  prepare.onclick = async () => {
    if (!current() || busy) return;
    if (o.canPrepare && !o.canPrepare()) { invalidate('Сначала сохраните изменения отчёта.'); return; }
    let captured;
    busy = true; clearFile(); controls(); state('GENERATING_PDF', 'Формируем PDF…');
    try {
      // Initial reports flush the latest edits here; no separate save step.
      const reportId = o.beforePrepare ? await o.beforePrepare() : o.reportId;
      if (!current()) return;
      if (!reportId) { state('ERROR', 'Изменения пока не сохранены. Повторите попытку.'); return; }
      captured = revision;
      const result = await o.sb.functions.invoke('generate-parent-report-pdf', {body:{report_id:reportId, report_kind:o.reportKind, mode:'export'}});
      if (!current() || captured !== revision) return;
      const blob = result.data;
      if (result.error || !blob || blob.type !== 'application/pdf' || !blob.size || blob.size > MAX_PDF_BYTES || typeof blob.arrayBuffer !== 'function') throw new Error();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!current() || captured !== revision) return;
      if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error();
      file = new view.File([bytes], 'Fizira-report.pdf', {type:'application/pdf'});
      previewUrl = view.URL.createObjectURL(file);
      find('[data-open-pdf]').href = previewUrl;
      preview = mountReportPdfPreview({root:find('[data-pdf-preview]'),bytes,isCurrent:() => current() && captured === revision});
      state('PDF_READY', 'PDF готов. Скачайте файл или передайте его через системное меню.');
      o.onReady?.();
    } catch {
      if (captured === undefined || captured === revision) state('ERROR', 'Не удалось сформировать PDF. Повторите попытку.');
    } finally { busy = false; controls(); }
  };
  download.onclick = () => { if (!busy && saveFile()) message('PDF передан браузеру для скачивания.'); };
  share.onclick = async () => {
    if (!current() || busy || !file) return;
    const data = {files:[file]};
    let supported = false;
    try { supported = typeof view.navigator.share === 'function' && typeof view.navigator.canShare === 'function' && view.navigator.canShare(data); } catch { /* use download */ }
    if (!supported) {
      if (saveFile()) message('Передача файла не поддерживается этим браузером. PDF передан для скачивания — отправьте его из «Файлов» или «Загрузок».');
      return;
    }
    busy = true; controls(); message('Открываем системное меню передачи PDF…');
    try {
      // No asynchronous work before share: preserve Safari's user activation.
      await view.navigator.share(data);
      message('PDF передан системному меню.');
    } catch (error) {
      if (error?.name === 'AbortError') message('Передача отменена. PDF можно скачать или передать повторно.');
      else if (saveFile()) message('Не удалось открыть системное меню. PDF передан для скачивания — отправьте файл вручную.');
    } finally { busy = false; controls(); }
  };
  edit.onclick = () => { if (current() && !busy) { invalidate(''); o.onEdit?.(); } };
  const observer = new view.MutationObserver(() => { if (!root.isConnected || root.firstElementChild !== section) dispose(); });
  observer.observe(root.ownerDocument.body, {childList:true, subtree:true});
  function dispose() { if (disposed) return; disposed = true; revision++; clearFile(); observer.disconnect(); }
  controls();
  return {invalidate, dispose};
}
