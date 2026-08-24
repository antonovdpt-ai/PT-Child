
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = "https://bpacboofedxhdjhiizpy.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Mo3Tk3_hyPGlBl_V48u82Q_7DQkXL9g";
const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
});

const app = document.getElementById('app');
const headerActions = document.getElementById('headerActions');
let session=null, user=null;
let state={patientId:null,tab:'overview',patients:[],goals:[],sessions:[],assessment:null};

const esc=(v='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const fmtDate=v=>{if(!v)return'дата не указана';const d=new Date(v+'T12:00:00');return d.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})};
const ageFromDob=dob=>{if(!dob)return'Возраст не указан';const b=new Date(dob+'T12:00:00'),n=new Date();let m=(n.getFullYear()-b.getFullYear())*12+n.getMonth()-b.getMonth();if(n.getDate()<b.getDate())m--;if(m<24)return `${m} мес.`;const y=Math.floor(m/12),r=m%12;return r?`${y} г. ${r} мес.`:`${y} г.`};
const sexLabel=v=>v==='male'?'Мальчик':v==='female'?'Девочка':'Не указано';
const toleranceLabel=v=>({good:'Хорошая',medium:'Средняя',low:'Низкая',unclear:'Трудно оценить'}[v]||'Не указана');

function flash(type,msg){const el=document.getElementById('flash');if(el)el.innerHTML=`<div class="${type}">${esc(msg)}</div>`}
function renderHeader(){if(!user){headerActions.innerHTML='';return}headerActions.innerHTML=`<div class="user-pill">${esc(user.email||'')}</div><button class="link" id="logoutBtn">Выйти</button>`;document.getElementById('logoutBtn').onclick=()=>sb.auth.signOut()}

async function init(){
  const {data}=await sb.auth.getSession();session=data.session;user=session?.user||null;renderHeader();
  sb.auth.onAuthStateChange(async(_e,s)=>{session=s;user=s?.user||null;renderHeader();if(user){await loadPatients();await renderPatients()}else renderLogin()});
  if(user){await loadPatients();await renderPatients()}else renderLogin();
}

function renderLogin(){
  app.innerHTML=`<div class="auth-wrap"><div class="card"><h2>Вход специалиста</h2><div id="flash"></div><form id="loginForm"><label>Email</label><input type="email" name="email" required autocomplete="email"><label>Пароль PT Child</label><input type="password" name="password" required autocomplete="current-password"><div class="actions"><button class="btn primary full" type="submit">Войти</button></div></form></div><div class="note">Используйте тестовую учётную запись, созданную в Supabase Authentication.</div></div>`;
  document.getElementById('loginForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const {error}=await sb.auth.signInWithPassword({email:fd.get('email').trim(),password:fd.get('password')});if(error)flash('error','Не удалось войти: '+error.message)};
}

async function loadPatients(){
  const {data,error}=await sb.from('patients').select('id,display_name,date_of_birth,sex,primary_complaint,status,created_at').order('created_at',{ascending:false});
  if(error)throw new Error(error.message);state.patients=data||[];
}
async function countsForPatients(){
  const ids=state.patients.map(p=>p.id);if(!ids.length)return{};
  const [g,s]=await Promise.all([sb.from('goals').select('patient_id').in('patient_id',ids),sb.from('sessions').select('patient_id').in('patient_id',ids)]);
  const out={};ids.forEach(id=>out[id]={goals:0,sessions:0});(g.data||[]).forEach(x=>out[x.patient_id].goals++);(s.data||[]).forEach(x=>out[x.patient_id].sessions++);return out;
}
async function renderPatients(){
  const counts=await countsForPatients();
  app.innerHTML=`<div class="topline"><div><h2 style="margin-bottom:2px">Пациенты</h2><div class="muted tiny">Облачная база · ${state.patients.length} пациентов</div></div><button class="btn primary small" id="addPatient">＋ Ребёнок</button></div><div id="flash"></div><div class="patient-list">${state.patients.map(p=>`<button class="patient-card" data-pid="${p.id}"><div class="patient-top"><div><div class="name">${esc(p.display_name)}</div><div class="meta">${esc(ageFromDob(p.date_of_birth))} · ${esc(sexLabel(p.sex))}</div></div><span class="badge">активное ведение</span></div><div class="item-sub" style="margin-top:9px">${esc(p.primary_complaint||'Причина обращения пока не заполнена')}</div><div class="metric-grid"><div class="metric"><b>${counts[p.id]?.goals||0}</b><span>целей</span></div><div class="metric"><b>${counts[p.id]?.sessions||0}</b><span>занятий</span></div></div></button>`).join('')||`<div class="card empty">В облачной базе пока нет пациентов.</div>`}</div>`;
  document.getElementById('addPatient').onclick=renderNewPatient;
  document.querySelectorAll('[data-pid]').forEach(b=>b.onclick=async()=>{state.patientId=b.dataset.pid;state.tab='overview';await loadPatientData();renderPatient()});
}

function renderNewPatient(){
  app.innerHTML=`<div class="topline"><h2 style="margin:0">Новый ребёнок</h2><button class="link" id="cancel">Отмена</button></div><div id="flash"></div><form class="card" id="patientForm"><label>Имя / псевдоним для теста</label><input name="display_name" required><div class="row"><div><label>Дата рождения</label><input type="date" name="date_of_birth"></div><div><label>Пол</label><select name="sex"><option value="unspecified">Не указано</option><option value="male">Мальчик</option><option value="female">Девочка</option></select></div></div><label>Основная причина обращения</label><textarea name="primary_complaint"></textarea><div class="actions"><button class="btn primary full" type="submit">Сохранить в облако</button></div></form>`;
  document.getElementById('cancel').onclick=renderPatients;
  document.getElementById('patientForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const payload={display_name:fd.get('display_name').trim(),date_of_birth:fd.get('date_of_birth')||null,sex:fd.get('sex'),primary_complaint:fd.get('primary_complaint').trim()||null};const {data,error}=await sb.from('patients').insert(payload).select().single();if(error)return flash('error',error.message);await loadPatients();state.patientId=data.id;state.tab='overview';await loadPatientData();renderPatient()};
}

const currentPatient=()=>state.patients.find(p=>p.id===state.patientId);
async function loadPatientData(){
  const pid=state.patientId;
  const [g,s,a]=await Promise.all([sb.from('goals').select('*').eq('patient_id',pid).order('created_at',{ascending:false}),sb.from('sessions').select('*').eq('patient_id',pid).order('session_date',{ascending:false}),sb.from('assessments').select('*').eq('patient_id',pid).eq('assessment_type','initial').order('created_at',{ascending:false}).limit(1)]);
  if(g.error||s.error||a.error)throw new Error((g.error||s.error||a.error).message);state.goals=g.data||[];state.sessions=s.data||[];state.assessment=(a.data||[])[0]||null;
}
function goalsHtml(goals,deletable=false){
  if(!goals.length)return`<div class="empty">Целей пока нет.</div>`;
  return goals.map(g=>`<div class="goal"><div class="goal-top"><div class="item-title">${esc(g.title)}</div><div class="goal-pct">${g.progress}%</div></div><div class="progress"><span style="width:${Math.max(0,Math.min(100,g.progress))}%"></span></div><div class="item-sub">${esc(g.criterion||'Критерий не указан')} · ${g.deadline?fmtDate(g.deadline):'срок не указан'}</div>${deletable?`<button class="link" style="color:#9b3333;margin-top:7px" data-del-goal="${g.id}">Удалить цель</button>`:''}</div>`).join('');
}
function renderPatient(){
  const p=currentPatient();if(!p)return renderPatients();
  const tabs=[['overview','Обзор'],['assessment','Оценка'],['goals','Цели'],['sessions','Занятия'],['progress','Динамика']];
  app.innerHTML=`<div class="card"><div class="patient-top"><div><div class="muted tiny">Карточка ребёнка</div><h1>${esc(p.display_name)}</h1><div class="meta">${esc(ageFromDob(p.date_of_birth))} · ${esc(sexLabel(p.sex))}</div></div><span class="badge">облако</span></div><div class="sep"></div><div class="item-title">${esc(p.primary_complaint||'Причина обращения пока не заполнена')}</div><div class="actions"><button class="btn full" id="backPatients">← К пациентам</button></div></div><div class="tabs">${tabs.map(([k,l])=>`<button class="tab ${state.tab===k?'active':''}" data-tab="${k}">${l}</button>`).join('')}</div><div id="flash"></div><div id="tabContent"></div>`;
  document.getElementById('backPatients').onclick=renderPatients;document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;renderPatient()});renderTab(p);
}
function renderTab(p){
  const box=document.getElementById('tabContent');
  if(state.tab==='overview'){box.innerHTML=`<div class="card"><h3>Сводка</h3><div class="metric-grid"><div class="metric"><b>${state.goals.filter(g=>g.status==='active').length}</b><span>активных целей</span></div><div class="metric"><b>${state.sessions.length}</b><span>занятий</span></div></div><div class="actions"><button class="btn primary" id="goSession">＋ Занятие</button><button class="btn" id="goGoal">＋ Цель</button></div></div><div class="card"><h3>Последнее занятие</h3>${state.sessions[0]?`<div class="item-title">${fmtDate(state.sessions[0].session_date)} · ${esc(toleranceLabel(state.sessions[0].tolerance))}</div><div class="item-sub">${esc(state.sessions[0].note||'')}</div>`:`<div class="empty">Занятий пока нет.</div>`}</div><div class="card"><h3>Текущие цели</h3>${goalsHtml(state.goals)}</div>`;document.getElementById('goSession').onclick=()=>{state.tab='sessions';renderPatient()};document.getElementById('goGoal').onclick=()=>{state.tab='goals';renderPatient()}}
  if(state.tab==='assessment'){const a=state.assessment||{};box.innerHTML=`<form class="card" id="assessmentForm"><h3>Первичная оценка</h3><label>Жалоба</label><textarea name="complaint">${esc(a.complaint||'')}</textarea><label>Беременность / анамнез</label><textarea name="pregnancy_history">${esc(a.pregnancy_history||'')}</textarea><label>Роды / ранний период</label><textarea name="birth_history">${esc(a.birth_history||'')}</textarea><label>Моторное развитие</label><textarea name="motor_development">${esc(a.motor_development||'')}</textarea><label>Осмотр / спонтанная моторика</label><textarea name="observation">${esc(a.observation||'')}</textarea><label>Неврологические наблюдения</label><textarea name="neuro_observations">${esc(a.neuro_observations||'')}</textarea><label>Физиотерапевтическое заключение</label><textarea name="conclusion">${esc(a.conclusion||'')}</textarea><div class="actions"><button class="btn primary full" type="submit">Сохранить оценку в облако</button></div></form>`;document.getElementById('assessmentForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target),payload=Object.fromEntries(fd.entries());payload.patient_id=p.id;payload.assessment_type='initial';let r=state.assessment?.id?await sb.from('assessments').update(payload).eq('id',state.assessment.id).select().single():await sb.from('assessments').insert(payload).select().single();if(r.error)return flash('error',r.error.message);state.assessment=r.data;flash('ok','Оценка сохранена в Supabase.')}}
  if(state.tab==='goals'){box.innerHTML=`<div class="card"><h3>Активные цели</h3>${goalsHtml(state.goals,true)}</div><form class="card" id="goalForm"><h3>＋ Новая цель</h3><label>Функциональная цель</label><textarea name="title" required></textarea><label>Исходное состояние</label><textarea name="baseline"></textarea><label>Критерий достижения</label><input name="criterion"><label>Срок</label><input type="date" name="deadline"><label>Прогресс</label><select name="progress"><option value="0">0%</option><option value="20">20%</option><option value="40">40%</option><option value="60">60%</option><option value="80">80%</option><option value="100">100%</option></select><div class="actions"><button class="btn primary full" type="submit">Добавить цель</button></div></form>`;document.getElementById('goalForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target),payload={patient_id:p.id,title:fd.get('title').trim(),baseline:fd.get('baseline').trim()||null,criterion:fd.get('criterion').trim()||null,deadline:fd.get('deadline')||null,progress:Number(fd.get('progress')),status:'active'};const {error}=await sb.from('goals').insert(payload);if(error)return flash('error',error.message);await loadPatientData();renderPatient()};document.querySelectorAll('[data-del-goal]').forEach(b=>b.onclick=async()=>{const {error}=await sb.from('goals').delete().eq('id',b.dataset.delGoal);if(error)return flash('error',error.message);await loadPatientData();renderPatient()})}
  if(state.tab==='sessions'){box.innerHTML=`<form class="card" id="sessionForm"><h3>＋ Новое занятие</h3><label>Дата</label><input type="date" name="session_date" value="${new Date().toISOString().slice(0,10)}"><label>Запись занятия</label><textarea name="note" required></textarea><label>Переносимость</label><select name="tolerance"><option value="good">Хорошая</option><option value="medium">Средняя</option><option value="low">Низкая</option><option value="unclear">Трудно оценить</option></select><div class="actions"><button class="btn primary full" type="submit">Сохранить занятие</button></div></form><div class="card"><h3>История занятий</h3>${state.sessions.map(s=>`<div class="item"><div class="item-title">${fmtDate(s.session_date)} · ${esc(toleranceLabel(s.tolerance))}</div><div class="item-sub">${esc(s.note||'')}</div><button class="link" style="color:#9b3333;margin-top:7px" data-del-session="${s.id}">Удалить</button></div>`).join('')||`<div class="empty">Занятий пока нет.</div>`}</div>`;document.getElementById('sessionForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target),payload={patient_id:p.id,session_date:fd.get('session_date'),note:fd.get('note').trim(),tolerance:fd.get('tolerance')};const {error}=await sb.from('sessions').insert(payload);if(error)return flash('error',error.message);await loadPatientData();renderPatient()};document.querySelectorAll('[data-del-session]').forEach(b=>b.onclick=async()=>{const {error}=await sb.from('sessions').delete().eq('id',b.dataset.delSession);if(error)return flash('error',error.message);await loadPatientData();renderPatient()})}
  if(state.tab==='progress'){box.innerHTML=`<div class="card"><h3>Динамика по целям</h3>${state.goals.length?state.goals.map(g=>`<div class="goal"><div class="goal-top"><div class="item-title">${esc(g.title)}</div><div class="goal-pct">${g.progress}%</div></div><div class="progress"><span style="width:${Math.max(0,Math.min(100,g.progress))}%"></span></div><div class="item-sub">${esc(g.criterion||'Критерий не указан')} · ${g.deadline?fmtDate(g.deadline):'срок не указан'}</div></div>`).join(''):`<div class="empty">Нет целей для динамики.</div>`}</div><div class="card"><div class="metric-grid"><div class="metric"><b>${state.sessions.length}</b><span>занятий</span></div><div class="metric"><b>${state.goals.filter(g=>g.progress>=100).length}</b><span>целей 100%</span></div></div></div>`}
}
init().catch(err=>{app.innerHTML=`<div class="error">Ошибка запуска приложения: ${esc(err.message)}</div>`});
