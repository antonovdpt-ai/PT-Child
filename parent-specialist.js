import { mountReportPdfExport } from './report-pdf-export.mjs?v=1';
import { escapeHtml as esc, safeSameOriginHttpsUrl } from './security-utils.mjs';
import { publicationLabel } from './parent-domain.mjs';

const initialFields = ['complaint', 'strengths', 'observations', 'goals', 'progress', 'recommendations'];
const sessionFields = ['what_did', 'what_worked', 'attention', 'home_recommendations'];
const labels = { complaint:'С чем обратились', strengths:'Что ребёнок умеет', observations:'На что обратили внимание', goals:'Над чем работаем', progress:'Динамика', recommendations:'Рекомендации домой', what_did:'Что делали', what_worked:'Что получилось', attention:'На что обратить внимание', home_recommendations:'Рекомендации домой' };
const generations = new WeakMap();
const emailValid = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const editable = report => !report.published_at && ['draft','publication_error'].includes(report.publication_status || 'draft');
const owned = (row, o) => row.patient_id === o.patient.id && row.therapist_id === o.user.id;

// Every continuation and retained handler belongs to exactly one mounted view.
function scope(o) {
  const generation = (generations.get(o.root) || 0) + 1;
  generations.set(o.root, generation);
  const current = () => o.root.isConnected && generations.get(o.root) === generation &&
    o.user?.id && o.patient?.therapist_id === o.user.id && o.isCurrent?.() === true;
  const status = message => { if (current()) { const el=o.root.querySelector('[data-status]'); if(el) el.textContent=message; } };
  const refresh = async invitationSent => { if (current()) await o.refresh?.(invitationSent === true); };
  let busy=false;
  const action = (button, operation, disabledAfter = () => false) => {
    button.onclick = async event => {
      event?.preventDefault();
      if (!current() || busy) return;
      busy=true; button.disabled=true;
      try { await operation(event); }
      catch { status('Не удалось выполнить действие. Повторите попытку.'); }
      finally { if(current()) { busy=false; button.disabled=disabledAfter(); } }
    };
  };
  return {current,status,refresh,action};
}
async function result(query) { const r=await query; if(r.error) throw new Error('Действие не выполнено'); return r.data; }
function query(o, table, columns) { return o.sb.from(table).select(columns).eq('patient_id',o.patient.id).eq('therapist_id',o.user.id); }
async function invoke(o, name, body) { const r=await o.sb.functions.invoke(name,{body}); if(r.error) throw new Error('Действие не выполнено'); return r.data; }
function confirm(o,message) { return o.root.ownerDocument.defaultView.confirm(message); }
const reportColumns = kind => ['id','patient_id','therapist_id','publication_status','published_at','created_at',...(kind==='initial'?['therapist_name',...initialFields]:['session_id',...sessionFields])].join(',');
function authorPayload(o, fields, values, session) {
  return {patient_id:o.patient.id,therapist_id:o.user.id,...(session?{session_id:session.id}:{}),...Object.fromEntries(fields.map(k=>[k, String(values[k]||'').trim() || null]))};
}

export async function renderParentSessionReportEditor(o) {
  if (!o.session || !owned(o.session,o)) return;
  return renderReportEditor({...o,kind:'session'});
}

async function renderReportEditor(o) {
  const s=scope(o); if(!s.current()) return;
  o.root.innerHTML='<p data-status role="status">Загружаем отчёт…</p>';
  const kind=o.kind,table=kind==='initial'?'parent_reports':'parent_session_reports',fields=kind==='initial'?initialFields:sessionFields;
  try {
    const reports=await result(query(o,table,reportColumns(kind)).order('created_at',{ascending:false}));
    if(!s.current()) return;
    const versions=(reports||[]).filter(r=>owned(r,o)&&(!o.session||r.session_id===o.session.id));
    let report=o.reportId ? versions.find(r=>r.id===o.reportId) : versions[0];
    if(o.reportId && !report) { s.status('Версия отчёта недоступна. Обновите список.'); return; }
    report ||= {publication_status:'draft'};
    let media=[],selected=[];
    if(kind==='session') {
      media=(await result(query(o,'patient_media','id,patient_id,therapist_id,media_type,storage_path,captured_at,created_at').eq('media_type','photo').order('created_at',{ascending:false}))).filter(r=>owned(r,o)&&r.media_type==='photo' && (!r.storage_path || (r.storage_path.startsWith(o.user.id+'/') && !r.storage_path.startsWith(o.user.id+'/parent-reports/'))));
      if(!s.current()) return;
      if(report.id) selected=await result(query(o,'parent_session_report_media','patient_media_id,position,patient_id,therapist_id').eq('parent_session_report_id',report.id));
      if(!s.current()) return;
    }
    const canEdit=editable(report),locked=report.publication_status==='publishing';
    o.root.innerHTML=`<section class="card parent-specialist-editor"><h3>${kind==='initial'?'Первичный отчёт для родителя':'Отчёт занятия для родителя'}</h3><p data-report-state>${esc(publicationLabel(report.publication_status))}</p>
      ${kind==='session'&&versions.length?`<nav class="parent-report-versions" aria-label="Версии отчёта занятия">${versions.map((v,i)=>`<button type="button" class="btn" data-session-version="${esc(v.id)}" ${v.id===report.id?'aria-current="true"':''}>Версия ${versions.length-i} · ${esc(v.created_at?new Date(v.created_at).toLocaleString('ru-RU'):'Дата не указана')} · ${esc(publicationLabel(v.publication_status))}</button>`).join('')}</nav>`:''}
      ${fields.map(k=>`<label>${esc(labels[k])}<textarea name="${k}" ${canEdit?'':'readonly'}>${esc(report[k]||'')}</textarea></label>`).join('')}
      ${kind==='session'?`<fieldset><legend>Явно выбрать фотографии</legend>${media.map((m,i)=>`<label class="parent-photo-choice"><input type="checkbox" name="media" value="${esc(m.id)}" ${(selected||[]).some(x=>x.patient_media_id===m.id)?'checked':''} disabled> Фото ${i+1} · ${esc(m.captured_at || m.created_at ? new Date(m.captured_at || m.created_at).toLocaleDateString('ru-RU') : 'Дата не указана')}<img data-photo="${esc(m.id)}" alt="Фото ${i+1}" hidden loading="lazy"><span data-photo-status>${canEdit?'Фото недоступно':'Опубликованная фотография сохранена в неизменяемой версии'}</span></label>`).join('') || '<p>Фотографий пока нет.</p>'}</fieldset>`:''}
      <div class="parent-specialist-actions">${canEdit?'<button type="button" class="btn" data-save-report>Сохранить черновик</button><button type="button" class="btn primary" data-publish-report>Отправить в кабинет родителя</button>':''}
      ${locked?'<button type="button" class="btn" data-refresh-report>Обновить статус</button><button type="button" class="btn" data-recover-report>Повторить генерацию PDF</button><p>Если публикация прервалась, повтор доступен после 15 минут. Доступность проверяет сервер.</p>':''}
      ${report.id&&!canEdit&&!locked?'<button type="button" class="btn" data-new-version>Новая версия</button>':''}
      ${report.publication_status==='published'?'<button type="button" class="btn" data-archive-report>В архив</button>':''}</div><div data-report-pdf-export></div><p data-status role="status"></p></section>`;
    let pdfControl, unsaved=false;
    let savedValues=Object.fromEntries(fields.map(k=>[k,String(report[k]||'').trim()]));
    const valuesMatch=()=>fields.every(k=>o.root.querySelector(`[name="${k}"]`).value.trim()===savedValues[k]);
    const mountPdf = () => {
      if(!report.id || locked || !s.current()) return;
      pdfControl=mountReportPdfExport({root:o.root.querySelector('[data-report-pdf-export]'), sb:o.sb, reportId:report.id, reportKind:kind, isCurrent:s.current, canPrepare:()=>!unsaved && valuesMatch()});
    };
    mountPdf();
    o.root.querySelectorAll('textarea,[name=media]').forEach(field=>field.addEventListener('input',()=>{unsaved=true;pdfControl?.invalidate();}));
    async function save() {
      if(!s.current() || !editable(report)) return false;
      if(kind==='session' && [...o.root.querySelectorAll('[name=media]:checked')].some(x=>x.disabled)) {
        s.status('Дождитесь загрузки выбранных фотографий перед сохранением и публикацией.'); return false;
      }
      const values=Object.fromEntries(fields.map(k=>[k,o.root.querySelector(`[name="${k}"]`).value]));
      const payload=authorPayload(o,fields,values,o.session);
      if(report.id) {
        const live = await result(query(o,table,reportColumns(kind)).eq('id',report.id).single());
        if(!s.current()) return false;
        if(!live || !owned(live,o) || !editable(live)) {
          s.status('Отчёт уже публикуется или опубликован. Обновите статус.');
          return false;
        }
        report=live;
        await result(o.sb.from(table).update(payload).eq('id',report.id).eq('patient_id',o.patient.id).eq('therapist_id',o.user.id).eq('publication_status',report.publication_status).select('id').single());
      } else {
        const row=await result(o.sb.from(table).insert(payload).select('id').single());
        if(!s.current()) return false;
        report={...payload,id:row.id,publication_status:'draft'};
      }
      if(!s.current()) return false;
      if(kind==='session') {
        const ids=[...o.root.querySelectorAll('[name=media]:checked')].filter(x=>!x.disabled).map(x=>x.value).filter(id=>media.some(m=>m.id===id));
        if(ids.length>100) throw new Error();
        await result(o.sb.from('parent_session_report_media').delete().eq('parent_session_report_id',report.id).eq('patient_id',o.patient.id).eq('therapist_id',o.user.id));
        if(!s.current()) return false;
        if(ids.length) await result(o.sb.from('parent_session_report_media').insert(ids.map((id,position)=>({parent_session_report_id:report.id,patient_media_id:id,patient_id:o.patient.id,therapist_id:o.user.id,position}))));
        if(!s.current()) return false;
      }
      savedValues=Object.fromEntries(fields.map(k=>[k,String(values[k]||'').trim()]));
      unsaved=!valuesMatch(); mountPdf();
      s.status('Черновик сохранён'); return true;
    }
    const bind=(selector,fn)=>{const b=o.root.querySelector(selector);if(b)s.action(b,fn);};
    bind('[data-save-report]',save);
    bind('[data-refresh-report]',()=>renderReportEditor({...o,reportId:report.id}));
    o.root.querySelectorAll('[data-session-version]').forEach(button=>s.action(button,()=>
      renderReportEditor({...o,reportId:button.dataset.sessionVersion})));
    async function generate(recovery=false) {
      if(!s.current() || !report.id) return;
      s.status('Публикуется…');
      // Recovery never saves text/media or unlocks metadata. The server owns lease/CAS.
      try {
        const data=await invoke(o,'generate-parent-report-pdf',{report_id:report.id,report_kind:kind});
        if(!s.current()) return;
        if(data?.publication_status!=='published') throw new Error();
        await s.refresh();
        if(s.current()) await renderReportEditor({...o,reportId:report.id});
      } catch {
        if(!s.current()) return;
        s.status(recovery?'Повторная генерация недоступна. Возможно, публикация ещё выполняется. Обновите статус или повторите позже.':'Ошибка публикации. Повторите генерацию PDF.');
      }
    }
    bind('[data-publish-report]',async()=>{
      if(!confirm(o,'Опубликовать проверенный текст и выбранные фотографии для родителя?')) return;
      if(!s.current() || !await save() || !s.current()) return;
      await generate();
    });
    bind('[data-recover-report]',async()=>{
      if(!confirm(o,'Повторить прерванную публикацию без изменения текста и фотографий? Сервер проверит срок ожидания.')) return;
      if(!s.current()) return;
      await generate(true);
    });
    bind('[data-new-version]',async()=>{
      const payload=authorPayload(o,fields,report,o.session);
      const row=await result(o.sb.from(table).insert(payload).select('id').single());
      if(!s.current()) return;
      // Only explicitly selected IDs may be copied, never frozen paths/metadata.
      if(kind==='session') {
        const ids=(selected||[]).map(x=>x.patient_media_id).filter(id=>media.some(m=>m.id===id));
        if(ids.length) await result(o.sb.from('parent_session_report_media').insert(ids.map((id,position)=>({parent_session_report_id:row.id,patient_media_id:id,patient_id:o.patient.id,therapist_id:o.user.id,position}))));
        if(!s.current()) return;
      }
      await renderReportEditor({...o,reportId:row.id});
    });
    bind('[data-archive-report]',async()=>{
      if(!confirm(o,'Убрать опубликованный отчёт из кабинета родителя?')) return;
      if(!s.current()) return;
      await result(o.sb.from(table).update({publication_status:'archived'}).eq('id',report.id).eq('patient_id',o.patient.id).eq('therapist_id',o.user.id).eq('publication_status','published'));
      if(!s.current()) return;
      await s.refresh();
      if(s.current()) await renderReportEditor({...o,reportId:report.id});
    });
    if (!canEdit) return; // A live source preview must never stand in for a frozen publication.
    for (const photo of media) {
      if (!s.current()) return;
      const img=[...o.root.querySelectorAll('[data-photo]')].find(el=>el.dataset.photo===photo.id);
      const label=img.closest('label'),choice=label.querySelector('input'),message=label.querySelector('[data-photo-status]');
      if (!photo.storage_path || !o.storageOrigin || !o.sb.storage) continue;
      try {
        const signed=await o.sb.storage.from('patient-media').createSignedUrl(photo.storage_path,60);
        if (!s.current()) return;
        const url=safeSameOriginHttpsUrl(signed.data?.signedUrl,o.storageOrigin);
        if (signed.error || !url) continue;
        img.onload=()=>{if(!s.current())return;message.textContent='';choice.disabled=!canEdit;};
        img.onerror=()=>{if(!s.current())return;img.hidden=true;message.textContent='Фото недоступно';choice.disabled=true;if(canEdit)choice.checked=false;};
        message.textContent='Загрузка фото…';img.hidden=false;img.src=url;
      } catch { if(!s.current()) return; }
    }
  } catch { s.status('Не удалось загрузить отчёт. Обновите вкладку.'); }
}

export async function renderParentPortalSpecialist(o) {
  const s=scope(o); if(!s.current()) return;
  o.root.innerHTML='<p data-status role="status">Загружаем кабинет родителя…</p>';
  try {
    const [invitations,access,initial,reports,publications,sessions]=await Promise.all([
      result(query(o,'parent_invitations','id,contact_id,patient_id,therapist_id,created_at,expires_at,accepted_at,revoked_at,email_normalized,accepted_by').order('created_at',{ascending:false})),
      result(query(o,'parent_child_access','id,contact_id,patient_id,therapist_id,status,granted_at,parent_user_id').order('granted_at',{ascending:false})),
      result(query(o,'parent_reports',reportColumns('initial')).order('created_at',{ascending:false})),
      result(query(o,'parent_session_reports',reportColumns('session')).order('created_at',{ascending:false})),
      result(query(o,'parent_goal_publications','id,goal_id,patient_id,therapist_id,title,description,status,published_at,unpublished_at')),
      result(query(o,'sessions','id,patient_id,therapist_id,session_date').order('session_date',{ascending:false}))
    ]);
    if(!s.current()) return;
    const safe=rows=>(rows||[]).filter(r=>owned(r,o));
    const contacts=(o.contacts||[]).filter(r=>owned(r,o));
    const published=safe(reports).filter(r=>r.publication_status==='published');
    // Count selected IDs only for published reports; no private artifacts are read.
    const selections=await result(query(o,'parent_session_report_media','parent_session_report_id,patient_media_id,patient_id,therapist_id'));
    if(!s.current()) return;
    const photoCount=safe(selections).filter(m=>published.some(r=>r.id===m.parent_session_report_id)).length;
    o.root.innerHTML=`<section class="card parent-specialist"><h2>Кабинет родителя</h2><p>Видимость: первичный отчёт — ${safe(initial).some(r=>r.publication_status==='published')?'опубликован':'не опубликован'}; отчёт занятия — ${published.length?'опубликован':'не опубликован'}; цели — ${safe(publications).filter(g=>g.published_at&&!g.unpublished_at).length}; фото — ${photoCount}.</p>
      <p data-status role="status" aria-live="polite">${o.invitationSent === true ? 'Приглашение отправлено. Проверьте получение письма родителем.' : ''}</p>
      <section aria-label="Родители и представители"><div class="parent-contacts-heading"><h3>Родители и представители</h3><button type="button" class="btn" data-add-parent>Добавить родителя / представителя</button><button type="button" class="btn" data-refresh-parent>Обновить статус</button></div>
      <p>Сохраните имя, родство и email представителя, затем отправьте ему приглашение.</p>
      <form data-parent-contact-form class="parent-contact-form" hidden>
        <h4>Новый родитель / представитель</h4>
        <div class="parent-contact-fields">
          <label>Имя<input name="full_name" required maxlength="200" autocomplete="name"></label>
          <label>Родство / роль<input name="relation" required maxlength="100" placeholder="Мать, отец, законный представитель"></label>
          <label>Email<input type="email" name="email" required maxlength="254" autocomplete="email"></label>
          <label>Телефон (необязательно)<input type="tel" name="phone" maxlength="50" autocomplete="tel"></label>
        </div>
        <div class="parent-specialist-actions"><button type="submit" class="btn primary" data-save-parent>Сохранить контакт</button><button type="button" class="btn" data-cancel-parent>Отмена</button></div>
        <p data-contact-status role="status" aria-live="polite"></p>
      </form>
      <div class="parent-specialist-contacts">${contacts.map(c=>{
        const activeAccess=safe(access).filter(x=>x.contact_id===c.id&&x.status==='active');
        const a=activeAccess[0];
        const i=safe(invitations).find(x=>x.contact_id===c.id&&!x.accepted_at&&!x.revoked_at);
        const accepted=safe(invitations).find(x=>x.contact_id===c.id&&x.accepted_at&&(!a||x.accepted_by===a.parent_user_id));
        const revoked=safe(access).some(x=>x.contact_id===c.id&&x.status==='revoked')||safe(invitations).some(x=>x.contact_id===c.id&&x.revoked_at);
        const expired=i && (!Number.isFinite(Date.parse(i.expires_at)) || Date.parse(i.expires_at)<=Date.now());
        const label=a?'Доступ активен':i?(expired?'Срок приглашения истёк':'Приглашение создано'):revoked?'Доступ отозван':accepted?'Приглашение принято; доступ не подтверждён':'Не приглашён';
        return `<article class="parent-contact" data-contact="${esc(c.id)}"><h4>${esc(c.full_name)}</h4><p>${esc(c.relation||'Родство не указано')}</p><p class="parent-access-state">${label}</p><p>${esc(c.email||'Email не указан')}</p>${c.phone?`<p>Телефон: ${esc(c.phone)}</p>`:''}
        ${activeAccess.map((entry,index)=>{
          const invitation=safe(invitations).find(x=>x.contact_id===c.id&&x.accepted_at&&x.accepted_by===entry.parent_user_id);
          return `<div class="parent-contact-access"><h5>Доступ ${index+1}</h5><p>Активирован · ${esc(entry.granted_at?new Date(entry.granted_at).toLocaleString('ru-RU'):'Дата не указана')}</p><p>Email доступа: ${esc(invitation?.email_normalized||'Не подтверждён в приглашениях')}</p><button type="button" class="btn danger" data-revoke="${esc(entry.id)}">Отозвать доступ</button></div>`;
        }).join('')}
        ${i?`<p>Email приглашения: ${esc(i.email_normalized||c.email||'Не указан')}</p><p>Действует до: ${esc(i.expires_at&&Number.isFinite(Date.parse(i.expires_at))?new Date(i.expires_at).toLocaleString('ru-RU'):'Срок не подтверждён')}</p><p class="muted">Проверьте получение письма: запись приглашения не подтверждает его доставку. Повторная отправка заменяет прежнюю ссылку.</p>`:''}
        <label>Email контакта<input type="email" name="email" maxlength="254" value="${esc(c.email||'')}"></label>
        ${a?'<p class="muted">Изменение email контакта не меняет аккаунт с доступом. Для замены родителя сначала отзовите доступ.</p>':''}
        <div class="parent-specialist-actions"><button type="button" class="btn" data-save-email>Сохранить email</button>${a?'':i?`<button type="button" class="btn" data-resend="${esc(i.id)}" ${emailValid(c.email||'')?'':'disabled'}>Отправить повторно</button>`:accepted&&!revoked?'<span>Обновите статус доступа</span>':`<button type="button" class="btn primary" data-invite ${emailValid(c.email||'')?'':'disabled'}>Отправить приглашение</button>`}</div>${!emailValid(c.email||'')?'<p class="muted">Укажите и сохраните корректный email перед отправкой приглашения.</p>':''}</article>`;
      }).join('')||'<p>Контактов пока нет. Добавьте родителя / представителя выше.</p>'}</div></section>
      <section class="parent-active-access"><h3>Доступы без сохранённого контакта</h3><p>Удаление контакта не отключает доступ родителя.</p>${safe(access).filter(a=>a.status==='active'&&!contacts.some(c=>c.id===a.contact_id)).map((a,i)=>
        `<article class="parent-contact"><h4>Доступ ${i+1} · Контакт удалён</h4><p>Доступ активен · Активирован ${esc(a.granted_at?new Date(a.granted_at).toLocaleString('ru-RU'):'Дата не указана')}</p><button type="button" class="btn danger" data-revoke="${esc(a.id)}">Отозвать доступ</button></article>`
      ).join('')||'<p>Таких доступов нет.</p>'}</section></section>
      <section class="card"><h3>Первичные отчёты</h3><button class="btn" data-create-initial>Новый черновик</button>${safe(initial).map(r=>`<p>${esc(publicationLabel(r.publication_status))} <button class="btn" data-open-initial="${esc(r.id)}">Открыть отчёт</button></p>`).join('')}<div data-initial-editor></div></section>
      <section class="card"><h3>Отчёты занятий</h3>${safe(sessions).map((r,i)=>`<button class="btn" data-session="${esc(r.id)}">Отчёт занятия ${esc(r.session_date||String(i+1))}</button>`).join('')}<div data-session-editor></div></section>
      <section class="card"><h3>Цели для родителя</h3><p>Опубликовано целей: ${safe(publications).filter(g=>g.published_at&&!g.unpublished_at).length}</p>
      ${safe(publications).filter(g=>g.published_at&&!g.unpublished_at).map(g=>`<article class="goal"><h4>${esc(g.title)}</h4>${g.description?`<p>${esc(g.description)}</p>`:''}<p>${esc(({new:'Новая',in_progress:'В работе',achieved:'Достигнута',paused:'Приостановлена',cancelled:'Отменена',revised:'Пересмотрена'})[g.status]||'Статус не указан')}</p></article>`).join('')||'<p>Опубликованных целей пока нет.</p>'}
      <button type="button" class="btn" data-manage-goals>Управлять целями</button></section>`;
    s.action(o.root.querySelector('[data-manage-goals]'),()=>o.manageGoals?.());
    let savedContactId=null;
    const contactForm=o.root.querySelector('[data-parent-contact-form]');
    const contactStatus=message=>{if(s.current())contactForm.querySelector('[data-contact-status]').textContent=message;};
    s.action(o.root.querySelector('[data-add-parent]'),()=>{if(savedContactId){s.status('Контакт сохранён. Не удалось обновить список; нажмите «Обновить статус».');return;}contactForm.hidden=false;contactForm.elements.full_name.focus();});
    s.action(o.root.querySelector('[data-refresh-parent]'),()=>s.refresh());
    s.action(o.root.querySelector('[data-cancel-parent]'),()=>{contactForm.hidden=true;contactForm.reset();contactStatus('');});
    const saveContact=o.root.querySelector('[data-save-parent]');
    s.action(saveContact,async event=>{
      event?.preventDefault();
      if(savedContactId){s.status('Контакт сохранён. Не удалось обновить список; нажмите «Обновить статус».');return;}
      const value=name=>contactForm.elements[name].value.trim();
      const payload={patient_id:o.patient.id,therapist_id:o.user.id,full_name:value('full_name'),relation:value('relation'),email:value('email').toLowerCase(),phone:value('phone')||null};
      if(!payload.full_name||payload.full_name.length>200||!payload.relation||payload.relation.length>100||!emailValid(payload.email)||(payload.phone?.length||0)>50){contactStatus('Заполните имя, родство и корректный email.');return;}
      contactStatus('Сохраняем контакт…');
      try {
        const row=await result(o.sb.from('patient_contacts').insert(payload).select('id').single());
        if(!s.current())return;
        if(!row?.id)throw new Error();
        savedContactId=row.id;
        contactForm.hidden=true;contactForm.reset();
        s.status('Контакт сохранён. Теперь можно отправить приглашение.');
        try{await s.refresh();}catch{s.status('Контакт сохранён. Не удалось обновить список; нажмите «Обновить статус».');}
      }catch{contactStatus('Не удалось сохранить контакт. Проверьте данные и повторите попытку.');}
    });
    contactForm.onsubmit=saveContact.onclick;
    async function sendInvitation(name,body) {
      s.status('Отправляем приглашение…');
      try {
        const data=await invoke(o,name,body);
        if(!s.current())return;
        if(data?.ok!==true||!Number.isFinite(Date.parse(data.expires_at)))throw new Error();
      }catch{s.status('Не удалось подтвердить отправку письма. Приглашение могло быть создано; нажмите «Обновить статус».');return;}
      s.status('Приглашение отправлено. Проверьте получение письма родителем.');
      try{await s.refresh(true);}catch{s.status('Приглашение отправлено. Не удалось обновить список; нажмите «Обновить статус».');}
    }
    contacts.forEach(c=>{
      const el=[...o.root.querySelectorAll('[data-contact]')].find(x=>x.dataset.contact===c.id);
      s.action(el.querySelector('[data-save-email]'),async()=>{
        const email=el.querySelector('[name=email]').value.trim().toLowerCase();
        if(email&&!emailValid(email)) {s.status('Введите корректный email');return;}
        await result(o.sb.from('patient_contacts').update({email:email||null}).eq('id',c.id).eq('patient_id',o.patient.id).eq('therapist_id',o.user.id).select('id').single());
        if(!s.current()) return;
        await s.refresh();
      });
      const invite=el.querySelector('[data-invite]'),resend=el.querySelector('[data-resend]');
      const emailInput=el.querySelector('[name=email]');
      const emailUnchanged=()=>emailInput.value.trim().toLowerCase()===(c.email||'').trim().toLowerCase();
      const savedEmailReady=()=>{if(!emailUnchanged()){s.status('Сохраните email контакта перед отправкой приглашения.');return false;}return emailValid(c.email||'');};
      emailInput.oninput=()=>{
        if(!s.current())return;
        for(const button of [invite,resend].filter(Boolean))button.disabled=!emailUnchanged()||!emailValid(c.email||'');
        if(invite||resend)s.status(emailUnchanged()?'':'Сохраните email контакта перед отправкой приглашения.');
      };
      if(invite)s.action(invite,async()=>{if(!savedEmailReady())return;await sendInvitation('create-parent-invitation',{patient_id:o.patient.id,contact_id:c.id});},()=>!emailUnchanged()||!emailValid(c.email||''));
      if(resend)s.action(resend,async()=>{if(!savedEmailReady())return;await sendInvitation('resend-parent-invitation',{invitation_id:resend.dataset.resend});},()=>!emailUnchanged()||!emailValid(c.email||''));

    });
    o.root.querySelectorAll('[data-revoke]').forEach(button=>s.action(button,async()=>{
      const accessId=button.dataset.revoke;
      if(!safe(access).some(a=>a.id===accessId&&a.status==='active')) return;
      if(!confirm(o,'Отключить доступ родителя к этому ребёнку?')) return;
      if(!s.current()) return;
      await invoke(o,'revoke-parent-access',{access_id:accessId});
      if(!s.current()) return;
      await s.refresh();
    }));
    const editorOptions=root=>({...o,root,isCurrent:()=>s.current()});
    const initialRoot=o.root.querySelector('[data-initial-editor]');
    s.action(o.root.querySelector('[data-create-initial]'),async()=>{
      const row=await result(o.sb.from('parent_reports').insert({patient_id:o.patient.id,therapist_id:o.user.id}).select('id').single());
      if(!s.current())return;await renderReportEditor({...editorOptions(initialRoot),kind:'initial',reportId:row.id});
    });
    o.root.querySelectorAll('[data-open-initial]').forEach(b=>s.action(b,()=>renderReportEditor({...editorOptions(initialRoot),kind:'initial',reportId:b.dataset.openInitial})));
    o.root.querySelectorAll('[data-session]').forEach(b=>s.action(b,()=>renderParentSessionReportEditor({...editorOptions(o.root.querySelector('[data-session-editor]')),session:safe(sessions).find(x=>x.id===b.dataset.session)})));
  } catch {s.status('Не удалось загрузить кабинет родителя. Обновите вкладку.');}
}
