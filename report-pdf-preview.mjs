// Render the actual generated PDF locally, including on browsers without a PDF viewer.
let renderer;
export function mountReportPdfPreview({root,bytes,isCurrent}) {
  const view = root.ownerDocument.defaultView;
  const canvas = root.querySelector('canvas'), note = root.querySelector('[data-pdf-preview-note]');
  let disposed = false, loadingTask = null, renderTask = null;
  const current = () => !disposed && root.isConnected && isCurrent();
  root.dataset.ready = 'false';
  canvas.hidden = true;
  note.textContent = 'Загружаем предпросмотр…';
  const ready = (async () => {
    try {
      if (typeof view.CanvasRenderingContext2D !== 'function') throw new Error('Canvas unavailable');
      renderer ||= import('./pdfjs-5.6.205.min.mjs');
      const pdfjs = await renderer;
      if (!current()) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdfjs-worker-5.6.205.min.mjs', import.meta.url).href;
      loadingTask = pdfjs.getDocument({data:bytes.slice(), isEvalSupported:false, useWasm:false, useWorkerFetch:false, useSystemFonts:false});
      const pdf = await loadingTask.promise;
      if (!current()) return;
      const page = await pdf.getPage(1);
      if (!current()) return;
      const original = page.getViewport({scale:1});
      const width = Math.min(600, Math.max(240, root.clientWidth || 360));
      const viewport = page.getViewport({scale:width / original.width});
      const ratio = Math.min(view.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      renderTask = page.render({canvasContext:canvas.getContext('2d'), viewport, transform:ratio === 1 ? null : [ratio,0,0,ratio,0,0]});
      await renderTask.promise;
      if (!current()) return;
      canvas.hidden = false;
      canvas.setAttribute('aria-label', `Первая страница отчёта Fizira. Всего страниц: ${pdf.numPages}.`);
      note.textContent = `Страница 1 из ${pdf.numPages}`;
      root.dataset.ready = 'true';
    } catch {
      if (current()) {
        root.dataset.ready = 'error';
        note.textContent = 'Не удалось показать предпросмотр. Откройте документ по ссылке ниже или скачайте PDF.';
      }
    } finally {
      renderTask = null;
      if (loadingTask) { const task = loadingTask; loadingTask = null; try { await task.destroy(); } catch { /* already cancelled */ } }
    }
  })();
  function dispose() {
    if (disposed) return;
    disposed = true;
    renderTask?.cancel();
    if (loadingTask) { const task = loadingTask; loadingTask = null; void task.destroy().catch(() => {}); }
    canvas.width = canvas.height = 0;
  }
  return {ready,dispose};
}
