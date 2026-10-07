// File export is independent of Parent Cabinet publication and permissions.
const views=new WeakMap();
const MAX_PDF_BYTES=10*1024*1024;
export function mountReportPdfExport(o) {
 const {root}=o,view=root.ownerDocument.defaultView;
 const generation=(views.get(root)||0)+1;views.set(root,generation);
 let file=null,busy=false,revision=0;
 let section;
 const current=()=>root.isConnected&&root.firstElementChild===section&&views.get(root)===generation&&o.isCurrent?.()===true;
 root.innerHTML='<section class="report-pdf-export"><p class="muted tiny">Передача PDF-файла не требует кабинета родителя и не предоставляет доступ к карточке.</p><div class="parent-specialist-actions"><button type="button" class="btn" data-prepare-pdf>Подготовить PDF</button><button type="button" class="btn" data-download-pdf disabled>Скачать PDF</button><button type="button" class="btn primary" data-share-pdf disabled>Поделиться PDF</button></div><p data-pdf-status role="status" aria-live="polite"></p></section>';
 section=root.firstElementChild;
 const prepare=root.querySelector('[data-prepare-pdf]'),download=root.querySelector('[data-download-pdf]'),share=root.querySelector('[data-share-pdf]'),status=root.querySelector('[data-pdf-status]');
 const message=text=>{if(current())status.textContent=text;};
 const controls=()=>{if(current()){prepare.disabled=busy;download.disabled=busy||!file;share.disabled=busy||!file;}};
 function invalidate(text='Отчёт изменён. Сохраните его и подготовьте PDF заново.') {revision++;file=null;message(text);controls();}
 function saveFile() {
  if(!current()||!file)return false;
  const url=view.URL.createObjectURL(file),anchor=root.ownerDocument.createElement('a');
  anchor.href=url;anchor.download=file.name;anchor.target='_blank';anchor.rel='noopener';
  root.ownerDocument.body.append(anchor);anchor.click();anchor.remove();
  view.setTimeout(()=>view.URL.revokeObjectURL(url),60000);
  return true;
 }
 prepare.onclick=async()=>{
  if(!current()||busy)return;
  if(o.canPrepare&&!o.canPrepare()){invalidate('Сначала сохраните изменения отчёта.');return;}
  if(!view.confirm('Вы проверили сохранённый текст? Подготовить PDF для передачи вне кабинета родителя?'))return;
  const captured=++revision;file=null;busy=true;controls();message('Подготавливаем PDF…');
  try {
   const r=await o.sb.functions.invoke('generate-parent-report-pdf',{body:{report_id:o.reportId,report_kind:o.reportKind,mode:'export'}});
   if(!current()||captured!==revision)return;
   const blob=r.data;
   if(r.error||!blob||blob.type!=='application/pdf'||!blob.size||blob.size>MAX_PDF_BYTES||typeof blob.arrayBuffer!=='function')throw new Error();
   const bytes=new Uint8Array(await blob.arrayBuffer());
   if(!current()||captured!==revision)return;
   if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw new Error();
   file=new view.File([bytes],'Fizira-report.pdf',{type:'application/pdf'});
   message('PDF готов. Скачайте файл или передайте его через системное меню.');
  }catch{if(captured===revision)message('Не удалось подготовить PDF. Проверьте соединение и повторите попытку.');}
  finally{busy=false;controls();}
 };
 download.onclick=()=>{if(!current()||busy||!file)return;if(saveFile())message('PDF передан браузеру для скачивания.');};
 share.onclick=async()=>{
  if(!current()||busy||!file)return;
  const data={files:[file]};let supported=false;
  try{supported=typeof view.navigator.share==='function'&&typeof view.navigator.canShare==='function'&&view.navigator.canShare(data);}catch{/* use download */}
  if(!supported){if(saveFile())message('Передача файла не поддерживается этим браузером. PDF передан для скачивания — отправьте его из «Файлов» или «Загрузок».');return;}
  busy=true;controls();message('Открываем системное меню передачи PDF…');
  try{
   // No asynchronous work before share: preserve Safari's transient user activation.
   await view.navigator.share(data);message('PDF передан системному меню.');
  }catch(error){
   if(error?.name==='AbortError')message('Передача отменена. PDF можно скачать или передать повторно.');
   else if(saveFile())message('Не удалось открыть системное меню. PDF передан для скачивания — отправьте файл вручную.');
  }finally{busy=false;controls();}
 };
 return {invalidate};
}
