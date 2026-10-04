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
  const refresh = async () => { if (current()) await o.refresh?.(); };
  let busy=false;
  const action = (button, operation) => {
    button.onclick = async () => {
      if (!current() || busy) return;
      busy=true; button.disabled=true;
      try { await operation(); }
      catch { status('Не удалось выполнить действие. Повторите попытку.'); }
      finally { if(current()) { busy=false; button.disabled=false; } }
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
      <div class="parent-specialist-actions">${canEdit?'<button type="button" class="btn" data-save-report>Сохранить черновик</button><button type="button" class="btn primary" data-publish-report>Опубликовать / повторить PDF</button>':''}
      ${locked?'<button type="button" class="btn" data-refresh-report>Обновить статус</button><button type="button" class="btn" data-recover-report>Повторить генерацию PDF</button><p>Если публикация прервалась, повтор доступен после 15 минут. Доступность проверяет сервер.</p>':''}
      ${report.id&&!canEdit&&!locked?'<button type="button" class="btn" data-new-version>Новая версия</button>':''}
      ${report.publication_status==='published'?'<button type="button" class="btn" data-archive-report>В архив</button>':''}</div><p data-status role="status"></p></section>`;
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
    const [invitations,access,initial,reports,publications,goals,sessions]=await Promise.all([
      result(query(o,'parent_invitations','id,contact_id,patient_id,therapist_id,created_at,expires_at,accepted_at,revoked_at').order('created_at',{ascending:false})),
      result(query(o,'parent_child_access','id,contact_id,patient_id,therapist_id,status,granted_at').order('granted_at',{ascending:false})),
      result(query(o,'parent_reports',reportColumns('initial')).order('created_at',{ascending:false})),
      result(query(o,'parent_session_reports',reportColumns('session')).order('created_at',{ascending:false})),
      result(query(o,'parent_goal_publications','id,goal_id,patient_id,therapist_id,title,description,status,published_at,unpublished_at')),
      result(query(o,'goals','id,patient_id,therapist_id').order('created_at',{ascending:false})),
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
      <p data-status role="status"></p><div class="parent-specialist-contacts">${contacts.map(c=>{
        const a=safe(access).find(x=>x.contact_id===c.id&&x.status==='active');
        const i=safe(invitations).find(x=>x.contact_id===c.id&&!x.accepted_at&&!x.revoked_at);
        const revoked=safe(access).some(x=>x.contact_id===c.id&&x.status==='revoked')||safe(invitations).some(x=>x.contact_id===c.id&&x.revoked_at);
        const label=a?'Активирован':i?'Приглашение отправлено':revoked?'Доступ отозван':'Не приглашён';
        return `<article class="parent-contact" data-contact="${esc(c.id)}"><h3>${esc(c.full_name)}</h3><p>${label}</p><p>${esc(c.email||'Email не указан')}</p><label>Email<input type="email" name="email" value="${esc(c.email||'')}"></label><div class="parent-specialist-actions"><button class="btn" data-save-email>Сохранить email</button>${a?'<span>Доступом можно управлять ниже</span>':i?`<button class="btn" data-resend="${esc(i.id)}">Повторить приглашение</button>`:`<button class="btn" data-invite ${emailValid(c.email||'')?'':'disabled'}>Пригласить</button>`}</div></article>`;
      }).join('')||'<p>Добавьте контакт в обзоре карточки.</p>'}</div>
      <section class="parent-active-access"><h3>Активные доступы</h3><p>Удаление контакта не отключает доступ родителя.</p>${safe(access).filter(a=>a.status==='active').map((a,i)=>{
        const c=contacts.find(c=>c.id===a.contact_id);
        return `<article class="parent-contact"><h4>Доступ ${i+1} · ${esc(c?.full_name||'Контакт удалён')}</h4><p>Активирован · ${esc(a.granted_at?new Date(a.granted_at).toLocaleString('ru-RU'):'Дата не указана')}</p><button type="button" class="btn" data-revoke="${esc(a.id)}">Отключить доступ</button></article>`;
      }).join('')||'<p>Активных доступов нет.</p>'}</section></section>
      <section class="card"><h3>Первичные отчёты</h3><button class="btn" data-create-initial>Новый черновик</button>${safe(initial).map(r=>`<p>${esc(publicationLabel(r.publication_status))} <button class="btn" data-open-initial="${esc(r.id)}">Открыть отчёт</button></p>`).join('')}<div data-initial-editor></div></section>
      <section class="card"><h3>Отчёты занятий</h3>${safe(sessions).map((r,i)=>`<button class="btn" data-session="${esc(r.id)}">Отчёт занятия ${esc(r.session_date||String(i+1))}</button>`).join('')}<div data-session-editor></div></section>
      <section class="card"><h3>Цели для родителя</h3>${safe(goals).map((g,i)=>{
        const p=safe(publications).find(x=>x.goal_id===g.id)||{};
        return `<form data-goal-form="${esc(g.id)}"><h4>Цель ${i+1}</h4><label>Название для родителя<input name="title" maxlength="500" required value="${esc(p.title||'')}"></label><label>Описание для родителя<textarea name="description">${esc(p.description||'')}</textarea></label><label>Статус<select name="status">${[['new','Новая'],['in_progress','В работе'],['achieved','Достигнута'],['revised','Пересмотрена']].map(([v,l])=>`<option value="${v}" ${p.status===v?'selected':''}>${l}</option>`).join('')}</select></label><p>${p.published_at&&!p.unpublished_at?'Опубликовано для родителя':'Не опубликовано'}</p><div class="parent-specialist-actions"><button type="button" class="btn" data-publish-goal>Опубликовать цель</button>${p.published_at&&!p.unpublished_at?'<button type="button" class="btn" data-withdraw-goal>Убрать из кабинета родителя</button>':''}</div></form>`;
      }).join('')||'<p>Добавьте рабочую цель во вкладке «Цели».</p>'}</section>`;
    contacts.forEach(c=>{
      const el=[...o.root.querySelectorAll('[data-contact]')].find(x=>x.dataset.contact===c.id);
      s.action(el.querySelector('[data-save-email]'),async()=>{
        const email=el.querySelector('[name=email]').value.trim().toLowerCase();
        if(email&&!emailValid(email)) {s.status('Введите корректный email');return;}
        await result(o.sb.from('patient_contacts').update({email:email||null}).eq('id',c.id).eq('patient_id',o.patient.id).eq('therapist_id',o.user.id));
        if(!s.current()) return;
        await s.refresh();
      });
      const invite=el.querySelector('[data-invite]'),resend=el.querySelector('[data-resend]');
      if(invite)s.action(invite,async()=>{if(!emailValid(c.email||''))return;await invoke(o,'create-parent-invitation',{patient_id:o.patient.id,contact_id:c.id});if(!s.current())return;await s.refresh();});
      if(resend)s.action(resend,async()=>{await invoke(o,'resend-parent-invitation',{invitation_id:resend.dataset.resend});if(!s.current())return;await s.refresh();});

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
    o.root.querySelectorAll('[data-goal-form]').forEach(form=>{
      form.onsubmit=e=>e.preventDefault();
      const p=safe(publications).find(x=>x.goal_id===form.dataset.goalForm);
      s.action(form.querySelector('[data-publish-goal]'),async()=>{
        const title=form.elements.title.value.trim(),status=form.elements.status.value;
        if(!title||title.length>500||!['new','in_progress','achieved','revised'].includes(status)){s.status('Проверьте название и статус цели');return;}
        if(!confirm(o,'Опубликовать эту формулировку цели для родителя?'))return;
        if(!s.current())return;
        const payload={goal_id:form.dataset.goalForm,patient_id:o.patient.id,therapist_id:o.user.id,title,description:form.elements.description.value.trim()||null,status,published_at:new Date().toISOString(),unpublished_at:null};
        await result(p?o.sb.from('parent_goal_publications').update(payload).eq('id',p.id).eq('patient_id',o.patient.id).eq('therapist_id',o.user.id):o.sb.from('parent_goal_publications').insert(payload));
        if(!s.current())return;await s.refresh();
      });
      const withdraw=form.querySelector('[data-withdraw-goal]');if(withdraw)s.action(withdraw,async()=>{
        if(!confirm(o,'Убрать цель из кабинета родителя?'))return;if(!s.current())return;
        await result(o.sb.from('parent_goal_publications').update({unpublished_at:new Date().toISOString()}).eq('id',p.id).eq('patient_id',o.patient.id).eq('therapist_id',o.user.id));
        if(!s.current())return;await s.refresh();
      });
    });
  } catch {s.status('Не удалось загрузить кабинет родителя. Обновите вкладку.');}
}
