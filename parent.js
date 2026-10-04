import { PARENT_NAV_ITEMS, formatParentDate, formatParentAge, dynamicsSeries, parentFileRequest } from './parent-domain.mjs';
import { escapeHtml as esc, safeSameOriginHttpsUrl } from './security-utils.mjs';
import { shouldRenderAuthEvent } from './auth-domain.mjs';

const LEGAL = [
  ['terms', 'Условия использования', 'https://fizira.com/terms'],
  ['privacy', 'Политика конфиденциальности', 'https://fizira.com/privacy'],
  ['personal_data_consent', 'Согласие на обработку персональных данных', 'https://fizira.com/consent'],
];
const ERROR = 'Не удалось загрузить данные. Попробуйте ещё раз.';
const array = value => Array.isArray(value) ? value : [];
const statuses = {planned:'Запланировано',completed:'Проведено',cancelled:'Отменено',no_show:'Неявка',new:'Новая',in_progress:'В работе',achieved:'Достигнута',revised:'Пересмотрена'};
const status = value => statuses[value] || 'Статус не указан';
const reportLabels = {complaint:'Запрос',strengths:'Сильные стороны',observations:'Наблюдения',goals:'Цели',progress:'Прогресс',recommendations:'Рекомендации',what_did:'Что делали',what_worked:'Что получилось',attention:'На что обратить внимание',home_recommendations:'Рекомендации для дома',therapist_name:'Специалист',therapist_profession:'Профессия',therapist_organization:'Организация',therapist_phone:'Телефон специалиста'};

export function createParentPortal({ app, sb, window, document, initialRecovery = false }) {
  let user = null, children = [], childId = null, section = 'home', mode = 'upcoming', roles = new Set();
  let revision = 0, recovery = initialRecovery || new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery';
  let invite = new URL(window.location.href).searchParams.get('invite'), subscription;
  const alive = ticket => ticket === revision && Boolean(user);
  const rpc = async (name, args) => { const { data, error } = await sb.rpc(name, args); if (error) throw new Error(ERROR); return data; };
  const button = (text, attrs='') => `<button type="button" class="btn" ${attrs}>${text}</button>`;
  const empty = text => `<p class="empty">${text}</p>`;
  const card = (title, body) => `<section class="card"><h2>${title}</h2>${body}</section>`;
  const passwordFields = required => `<label>Новый пароль<input name="password" type="password" minlength="8" autocomplete="new-password" ${required?'required':''}></label><label>Повторите пароль<input name="confirm" type="password" autocomplete="new-password" ${required?'required':''}></label>`;
  function message(text, target=app.querySelector('[role="status"]')) { if (target) target.textContent = text; }
  function shell(body) {
    app.innerHTML = `<div class="parent-topline"><div><h1>Личный кабинет родителя</h1><p class="muted">Вместе следим за развитием ребёнка</p></div><div class="parent-account">${button('Профиль','data-section="profile"')}${button('Выйти','id="logoutBtn"')}</div></div>${roles.has('specialist')?'<p><a href="index.html">Кабинет специалиста</a></p>':''}<label>Ребёнок<select id="childPicker">${children.map(c=>`<option value="${esc(c.id)}" ${c.id===childId?'selected':''}>${esc(c.display_name)} · ${esc(formatParentAge(c.date_of_birth))}</option>`).join('')}</select></label><nav class="parent-nav" aria-label="Разделы кабинета">${PARENT_NAV_ITEMS.map(n=>button(n.label,`data-section="${n.id}" aria-current="${section===n.id?'page':'false'}"`)).join('')}</nav><div id="parentContent">${body}</div>`;
    app.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>navigate(b.dataset.section));
    app.querySelector('#childPicker').onchange=e=>selectChild(e.target.value);
    app.querySelector('#logoutBtn').onclick=logout;
  }
  function failure(retry) { shell(card('Данные недоступны',`<p role="status">${ERROR}</p>${button('Повторить','id="retryBtn"')}`));app.querySelector('#retryBtn').onclick=retry; }
  function login() {
    app.innerHTML=card('Вход для родителей',`<p>Войдите в аккаунт, на который специалист отправил приглашение.</p><form id="loginForm"><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Пароль<input name="password" type="password" autocomplete="current-password" required></label><p role="status" aria-live="polite"></p><button class="btn primary">Войти</button></form>${button('Забыли пароль?','id="recoverBtn"')}`);
    app.querySelector('#loginForm').onsubmit=async e=>{e.preventDefault();const ticket=revision;const form=e.currentTarget;const b=form.querySelector('button');b.disabled=true;try{const {error}=await sb.auth.signInWithPassword({email:form.elements.email.value.trim(),password:form.elements.password.value});if(error)throw error;if(ticket===revision)message('Выполняется вход…');}catch{if(ticket===revision){b.disabled=false;message('Не удалось войти. Проверьте email и пароль.');}}};
    app.querySelector('#recoverBtn').onclick=()=>{revision++;app.innerHTML=card('Восстановление пароля',`<form id="recoveryForm"><label>Email<input type="email" name="email" autocomplete="email" required></label><p role="status" aria-live="polite"></p><button class="btn primary">Отправить ссылку</button></form>${button('Назад ко входу','id="backLogin"')}`);app.querySelector('#backLogin').onclick=login;app.querySelector('#recoveryForm').onsubmit=async e=>{e.preventDefault();const ticket=revision;const form=e.currentTarget;form.querySelector('button').disabled=true;try{await sb.auth.resetPasswordForEmail(form.elements.email.value.trim(),{redirectTo:new URL('parent.html',window.location.href).href});}catch{}if(ticket===revision)message('Если аккаунт существует, ссылка для восстановления отправлена на email.');};};
  }
  function wirePassword(form, onSuccess) {
    form.onsubmit=async e=>{e.preventDefault();const password=form.elements.password.value, confirm=form.elements.confirm.value;if(password.length<8||password!==confirm)return message('Введите одинаковые пароли длиной не менее 8 символов.');const ticket=revision;const b=form.querySelector('button');b.disabled=true;try{const {error}=await sb.auth.updateUser({password});if(error)throw error;if(alive(ticket)){form.reset();message('Пароль сохранён.');if(onSuccess)await onSuccess();}}catch{if(alive(ticket))message('Не удалось изменить пароль. Попробуйте ещё раз.');}finally{if(alive(ticket))b.disabled=false;}};
  }
  async function showInvitation(ticket) {
    app.innerHTML=card('Приглашение', '<p class="parent-skeleton" role="status">Проверяем приглашение…</p>');
    let result;try{result=await rpc('parent_invitation_state',{p_token:invite});}catch{}
    if(!alive(ticket))return;
    if(result?.state!=='valid'||!['new','existing'].includes(result.auth_flow)){app.innerHTML=card('Приглашение недоступно','<p>Попросите специалиста отправить новое приглашение на ваш email.</p>'+button('Выйти','id="logoutBtn"'));app.querySelector('#logoutBtn').onclick=logout;return;}
    const isNew=result.auth_flow==='new';
    app.innerHTML=card('Добро пожаловать в Fizira',`<p>Подтвердите доступ к кабинету родителя.</p><form id="inviteForm"><label>Ваше имя<input name="full_name" autocomplete="name" value="${esc(user.user_metadata?.full_name||'')}" required></label>${passwordFields(isNew)}${!isNew?'<p class="muted">Вы уже вошли в аккаунт. Новый пароль можно оставить пустым.</p>':''}<fieldset><legend>Перед продолжением ознакомьтесь с документами</legend>${LEGAL.map(([type,label,url])=>`<label class="parent-check"><input type="checkbox" name="legal" value="${type}" required><span>Принимаю: <a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a></span></label>`).join('')}</fieldset><p role="status" aria-live="polite"></p><button class="btn primary">Принять приглашение</button></form>`);
    app.querySelector('#inviteForm').onsubmit=async e=>{
      e.preventDefault();const form=e.currentTarget;const name=form.elements.full_name.value.trim(),password=form.elements.password.value,confirm=form.elements.confirm.value;const accepted=[...form.querySelectorAll('[name="legal"]')].filter(i=>i.checked);
      if(!name||accepted.length!==3)return message('Укажите имя и примите все три документа.');
      if((isNew||password||confirm)&&(password.length<8||password!==confirm))return message('Введите одинаковые пароли длиной не менее 8 символов.');
      form.querySelector('button').disabled=true;
      try{const {data,error}=await sb.auth.updateUser({data:{full_name:name},...(password?{password}: {})});if(error)throw error;if(!alive(ticket))return;user=data?.user||user;
        await rpc('accept_parent_invitation',{p_token:invite,p_accepted_documents:LEGAL.map(([document_type])=>({document_type,accepted:true}))});if(!alive(ticket))return;
        const url=new URL(window.location.href);url.searchParams.delete('invite');url.hash='';window.history.replaceState(null,'',url.href);invite=null;await enter();
      }catch{if(alive(ticket)){message('Не удалось принять приглашение. Попробуйте ещё раз или попросите новую ссылку.');form.querySelector('button').disabled=false;}}
    };
  }
  const scheduleRows = rows => array(rows).map(r=>`<div class="item"><b>${esc(appointmentDate(r.starts_at))}</b><p>${esc(time(r.starts_at))} — ${esc(time(r.ends_at))} · ${esc(status(r.status))}</p></div>`).join('')||empty('Занятий пока нет');
  function appointmentDate(value) { const d=new Date(value);return Number.isNaN(d.getTime())?'Дата не указана':d.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}); }
  function time(value) { const d=new Date(value);return Number.isNaN(d.getTime())?'Время не указано':d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}); }
  const reportsRows = rows => array(rows).map(r=>`<div class="item"><p>${r.kind==='initial'?'Первичный отчёт':'Отчёт о занятии'} · ${esc(formatParentDate(r.published_at))}</p>${button('Открыть отчёт',`data-report="${esc(r.id)}"`)}</div>`).join('')||empty('Опубликованных отчётов пока нет');
  const goalRows = rows => array(rows).map(g=>`<div class="goal"><h3>${esc(g.title)}</h3><p>${esc(g.description)}</p><span class="badge">${esc(status(g.status))}</span></div>`).join('')||empty('Опубликованных целей пока нет');
  function dynamics(rows) {const series=dynamicsSeries(rows);const numeric=series.numeric.map(s=>`<h3>${esc(s.scale.toUpperCase())}</h3><table><thead><tr><th>Дата</th><th>Результат</th></tr></thead><tbody>${s.points.map(p=>`<tr><td>${esc(formatParentDate(p.assessed_at))}</td><td>${esc(p.value)}</td></tr>`).join('')}</tbody></table>`).join('');const categorical=series.categorical.map(p=>`<p><b>${esc(p.scale.toUpperCase())}</b> · ${esc(formatParentDate(p.assessed_at))}: ${esc(p.value)}</p>`).join('');return numeric||categorical?`${numeric}${categorical}<p class="muted">Результаты оценок стоит обсудить со специалистом. Уровни классификаций показаны как категории.</p>`:empty('Оценок пока нет');}
  function wireReports(){app.querySelectorAll('[data-report]').forEach(b=>b.onclick=()=>openReport(b.dataset.report));}
  function profile() {
    shell(card('Профиль',`<p>${esc(user.email)}</p><form id="profileForm"><label>Ваше имя<input name="full_name" autocomplete="name" value="${esc(user.user_metadata?.full_name||'')}" required></label><button class="btn primary">Сохранить имя</button></form><p role="status" aria-live="polite"></p>`)+card('Изменить пароль',`<form id="passwordForm">${passwordFields(true)}<button class="btn primary">Сохранить пароль</button></form>`));
    app.querySelector('#profileForm').onsubmit=async e=>{e.preventDefault();const ticket=revision,form=e.currentTarget,name=form.elements.full_name.value.trim();if(!name)return message('Укажите имя.');const b=form.querySelector('button');b.disabled=true;try{const {data,error}=await sb.auth.updateUser({data:{full_name:name}});if(error)throw error;if(alive(ticket)){user=data?.user||user;message('Имя сохранено.');}}catch{if(alive(ticket))message('Не удалось сохранить имя.');}finally{if(alive(ticket))b.disabled=false;}};
    wirePassword(app.querySelector('#passwordForm'));
  }
  async function navigate(next) {
    if(!user || ![...PARENT_NAV_ITEMS.map(item => item.id), 'profile'].includes(next))return; section=next;const ticket=++revision;
    if(next==='profile'){profile();return;}
    shell('<div class="card parent-skeleton" role="status" aria-busy="true">Загружаем…</div>');
    if(!childId){shell(empty('Нет доступных детей. Попросите специалиста отправить приглашение.'));return;}
    try{
      const data=await rpc(`parent_portal_${next==='home'?'dashboard':next}`,{p_patient_id:childId,...(next==='schedule'?{p_mode:mode}:{})});if(!alive(ticket))return;
      let body='';
      if(next==='home') {
        if(!data?.child){shell(empty('Доступ к ребёнку больше недоступен. Обратитесь к специалисту.'));return;}
        body=card('Ближайшее занятие',scheduleRows(array(data.schedule).slice(0,1)))+card('Последние отчёты',reportsRows(array(data.reports).slice(0,2)))+card('Цели',goalRows(array(data.goals).slice(0,2)))+card('Динамика',dynamics(data.dynamics))+card('Уведомления',array(data.notifications).map(n=>`<div class="item"><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p>${!n.read_at?button('Отметить прочитанным',`data-read="${esc(n.id)}"`):'<span class="muted">Прочитано</span>'}</div>`).join('')||empty('Новых уведомлений нет'));
      } else if(next==='schedule')body=card('Расписание',`<div class="parent-modes">${button('Предстоящие','data-mode="upcoming"')}${button('История','data-mode="history"')}</div>${scheduleRows(data)}`);
      else if(next==='reports')body=card('Отчёты',reportsRows(data));else if(next==='goals')body=card('Цели',goalRows(data));else if(next==='dynamics')body=card('Динамика',dynamics(data));
      shell(body);wireReports();app.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;navigate('schedule');});
      app.querySelectorAll('[data-read]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await rpc('parent_mark_notifications_read',{p_notification_ids:[b.dataset.read]});if(!alive(ticket))return;const notifications=await rpc('parent_portal_notifications',{p_patient_id:childId});if(alive(ticket)){const notification=array(notifications).find(n=>n.id===b.dataset.read);b.textContent=notification?.read_at?'Прочитано':'Уведомление недоступно';}}catch{if(alive(ticket)){b.disabled=false;b.textContent='Повторить';}}});
    }catch{if(alive(ticket))failure(()=>navigate(next));}
  }
  async function selectChild(id){if(!children.some(c=>c.id===id))return;childId=id;mode='upcoming';await navigate(section);}
  async function invokeFile(kind,reportId,mediaId) {
    const body=parentFileRequest({kind,reportId,...(kind==='photo'?{mediaId}:{})});
    const {data,error}=await sb.functions.invoke('parent-report-file',{body});
    const url=safeSameOriginHttpsUrl(data?.url,'https://auth.fizira.com');
    if(error||!url)throw new Error('Файл недоступен');
    const parsed=new URL(url);
    if(parsed.username||parsed.password||!parsed.pathname.startsWith('/storage/v1/object/sign/patient-media/'))throw new Error('Файл недоступен');
    return {name:'parent-report-file',url};
  }
  async function openReport(id) {
    const ticket=++revision;shell('<div class="card parent-skeleton" role="status">Загружаем отчёт…</div>');
    try{const data=await rpc('parent_portal_report',{p_report_id:id});if(!alive(ticket))return;const report=data?.report;if(!report){shell(card('Отчёт недоступен',empty('Специалист ещё не опубликовал отчёт или доступ изменился.')));return;}
      shell(card('Отчёт',`${button('К списку отчётов','data-section="reports"')}<p>${esc(formatParentDate(report.published_at))}</p>${Object.entries(reportLabels).filter(([key])=>report.snapshot?.[key]).map(([key,label])=>`<h3>${label}</h3><p class="parent-prose">${esc(report.snapshot[key])}</p>`).join('')}${button('Скачать PDF','id="downloadReport"')}<p role="status" aria-live="polite"></p>${array(report.media_ids).map(mediaId=>`<div class="parent-photo">${button('Открыть фото',`data-photo="${esc(mediaId)}"`)}</div>`).join('')}`));
      app.querySelector('#downloadReport').onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{const file=await invokeFile('pdf',id);if(!alive(ticket))return;const a=document.createElement('a');a.href=file.url;a.target='_blank';a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';a.download='report.pdf';a.click();}catch{if(alive(ticket))message('PDF недоступен. Попробуйте ещё раз.');}finally{if(alive(ticket))b.disabled=false;}};
      app.querySelectorAll('[data-photo]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const file=await invokeFile('photo',id,b.dataset.photo);if(!alive(ticket))return;const img=document.createElement('img');img.alt='Фото из отчёта';img.referrerPolicy='no-referrer';img.onload=()=>{if(alive(ticket))b.replaceWith(img);};img.onerror=()=>{if(alive(ticket))b.textContent='Фото недоступно';};img.src=file.url;}catch{if(alive(ticket))b.textContent='Фото недоступно';}});
    }catch{if(alive(ticket))failure(()=>openReport(id));}
  }
  async function enter() {
    const ticket=++revision;children=[];childId=null;roles=new Set();
    if(!user){login();return;}
    if(recovery){app.innerHTML=card('Новый пароль',`<form id="passwordForm">${passwordFields(true)}<p role="status" aria-live="polite"></p><button class="btn primary">Сохранить пароль</button></form>`);wirePassword(app.querySelector('#passwordForm'),async()=>{recovery=false;window.history.replaceState(null,'',window.location.pathname+window.location.search);await enter();});return;}
    if(invite){await showInvitation(ticket);return;}
    app.innerHTML=card('Личный кабинет родителя','<p class="parent-skeleton" role="status">Проверяем доступ…</p>');
    try{const roleRows=await rpc('current_app_roles');if(!alive(ticket))return;roles=new Set(array(roleRows).map(r=>r.role));if(!roles.has('parent')){shell(card('Доступ не предоставлен',empty('Попросите специалиста отправить приглашение на ваш email.')));return;}const rows=await rpc('parent_portal_children');if(!alive(ticket))return;children=array(rows);childId=children[0]?.id||null;section='home';await navigate('home');}catch{if(alive(ticket))failure(enter);}
  }
  async function logout(){revision++;user=null;children=[];childId=null;roles=new Set();recovery=false;login();try{const {error}=await sb.auth.signOut();if(error)throw error;}catch{message('Не удалось завершить выход. Обновите страницу и попробуйте ещё раз.');}}
  async function start() {
    let received=false;
    subscription=sb.auth.onAuthStateChange((event,session)=>{received=true;const previous=user?.id||null,next=session?.user?.id||null;
      if(event==='PASSWORD_RECOVERY')recovery=true;
      if(!shouldRenderAuthEvent(event,previous,next))return;
      revision++;user=session?.user||null;children=[];childId=null;roles=new Set();if(event==='SIGNED_OUT')recovery=false;
      if(event==='SIGNED_OUT')login();else app.replaceChildren();const ticket=revision;window.setTimeout(()=>{if(ticket===revision)enter();},0);
    }).data?.subscription;
    const {data,error}=await sb.auth.getSession();if(error){login();message('Не удалось проверить вход. Повторите попытку.');return;}
    if(!received){user=data?.session?.user||null;await enter();}
  }
  return {start,navigate,selectChild,openReport,invokeFile,logout,destroy(){revision++;subscription?.unsubscribe();app.replaceChildren();}};
}

// Browser entry is intentionally opt-in so the portal is independently testable.
if (typeof document !== 'undefined' && document.getElementById('app')?.dataset.parentEntry === 'true') {
  const initialRecovery=new URLSearchParams(window.location.hash.slice(1)).get('type')==='recovery';
  const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm');
  const sb=createClient('https://auth.fizira.com','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg5NjU2NzI5LCJleHAiOjE5NDczMzY3Mjl9.gWkGsKODazY419TdwTGoSL9InQK3Yzt5YYC7UGVFllo',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  createParentPortal({app:document.getElementById('app'),sb,window,document,initialRecovery}).start().catch(()=>{document.getElementById('app').textContent=ERROR;});
}
