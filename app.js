
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = "https://bpacboofedxhdjhiizpy.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Mo3Tk3_hyPGlBl_V48u82Q_7DQkXL9g";
const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const app = document.getElementById('app');
const headerActions = document.getElementById('headerActions');
let session = null, user = null;
let state = { patientId: null, tab: 'overview', patients: [], goals: [], sessions: [], assessment: null };

const esc = (v = '') => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const fmtDate = v => { if (!v) return 'дата не указана'; const d = new Date(v + 'T12:00:00'); return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) };
const ageFromDob = dob => { if (!dob) return 'Возраст не указан'; const b = new Date(dob + 'T12:00:00'), n = new Date(); let m = (n.getFullYear() - b.getFullYear()) * 12 + n.getMonth() - b.getMonth(); if (n.getDate() < b.getDate()) m--; if (m < 24) return `${m} мес.`; const y = Math.floor(m / 12), r = m % 12; return r ? `${y} г. ${r} мес.` : `${y} г.` };
const sexLabel = v => v === 'male' ? 'Мальчик' : v === 'female' ? 'Девочка' : 'Не указано';
const toleranceLabel = v => ({ good: 'Хорошая', medium: 'Средняя', low: 'Низкая', unclear: 'Трудно оценить' }[v] || 'Не указана');

function flash(type, msg) { const el = document.getElementById('flash'); if (el) el.innerHTML = `<div class="${type}">${esc(msg)}</div>` }

async function callAI(prompt) {
  const cleanPrompt = String(prompt || "").trim();

  if (!cleanPrompt) {
    throw new Error("Пустой запрос к ИИ");
  }

  const { data, error } = await sb.functions.invoke("ptchild-ai", {
    body: { prompt: cleanPrompt }
  });

  if (error) {
    throw error;
  }

  if (!data?.text) {
    throw new Error("ИИ не вернул ответ");
  }

  return data.text;
}

// Временно для проверки из консоли браузера
window.callAI = callAI;

function formatAIAnalysisDate(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatAIAnalysisBlock(text, updatedAt) {
  const dateText = formatAIAnalysisDate(updatedAt);

  const dateHtml = dateText
    ? `<div class="muted tiny" style="margin-bottom:10px">
        Последний анализ ИИ: ${dateText}
      </div>`
    : "";

  return dateHtml + formatAIResult(text);
}

function formatAIResult(text) {
  const safe = String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return safe
    // Заголовки
    .replace(/^### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/^# (.+)$/gm, "<h2>$1</h2>")

    // Жирный текст
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")

    // Разделители
    .replace(/^---$/gm, "<hr>")

    // Переносы строк
    .replace(/\n/g, "<br>");
}
function renderHeader() { if (!user) { headerActions.innerHTML = ''; return } headerActions.innerHTML = `<div class="user-pill">${esc(user.email || '')}</div><button class="link" id="logoutBtn">Выйти</button>`; document.getElementById('logoutBtn').onclick = () => sb.auth.signOut() }

function setButtonSaving(btn, text = 'Сохраняю…') { btn.disabled = true; btn.classList.remove('saved'); btn.classList.add('saving'); btn.textContent = text }
function setButtonSaved(btn, text = '✓ Сохранено') { btn.disabled = true; btn.classList.remove('saving'); btn.classList.add('saved'); btn.textContent = text }
function setButtonDirty(btn, text = 'Сохранить изменения') { btn.disabled = false; btn.classList.remove('saving', 'saved'); btn.classList.add('primary'); btn.textContent = text }
function setButtonError(btn, text = 'Повторить сохранение') { btn.disabled = false; btn.classList.remove('saving', 'saved'); btn.classList.add('primary'); btn.textContent = text }
function watchFormDirty(form, btn, dirtyText = 'Сохранить изменения') { form.addEventListener('input', () => setButtonDirty(btn, dirtyText)); form.addEventListener('change', () => setButtonDirty(btn, dirtyText)) }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function init() {
  const { data } = await sb.auth.getSession(); session = data.session; user = session?.user || null; renderHeader();
  sb.auth.onAuthStateChange(async (_e, s) => { session = s; user = s?.user || null; renderHeader(); if (user) { await loadPatients(); await renderPatients() } else renderLogin() });
  if (user) { await loadPatients(); await renderPatients() } else renderLogin();
}

function renderLogin() {
  app.innerHTML = `<div class="auth-wrap"><div class="card"><h2>Вход специалиста</h2><div id="flash"></div><form id="loginForm"><label>Email</label><input type="email" name="email" required autocomplete="email"><label>Пароль PT Child</label><input type="password" name="password" required autocomplete="current-password"><div class="actions"><button class="btn primary full" type="submit">Войти</button></div></form></div><div class="note">Используйте тестовую учётную запись, созданную в Supabase Authentication.</div></div>`;
  document.getElementById('loginForm').onsubmit = async e => { e.preventDefault(); const btn = e.submitter; setButtonSaving(btn, 'Вхожу…'); const fd = new FormData(e.target); const { error } = await sb.auth.signInWithPassword({ email: fd.get('email').trim(), password: fd.get('password') }); if (error) { setButtonError(btn, 'Войти'); flash('error', 'Не удалось войти: ' + error.message) } };
}

async function loadPatients() {
  const { data, error } = await sb
    .from("patients")
    .select(
      "id,display_name,date_of_birth,sex,primary_complaint,status,created_at,ai_analysis,ai_analysis_updated_at"
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  state.patients = data || [];
}
async function countsForPatients() {
  const ids = state.patients.map((p) => p.id);

  if (!ids.length) return {};

  const [g, s] = await Promise.all([
    sb.from("goals").select("patient_id").in("patient_id", ids),
    sb.from("sessions").select("patient_id").in("patient_id", ids),
  ]);

  const out = {};

  ids.forEach((id) => {
    out[id] = { goals: 0, sessions: 0 };
  });

  (g.data || []).forEach((x) => {
    out[x.patient_id].goals++;
  });

  (s.data || []).forEach((x) => {
    out[x.patient_id].sessions++;
  });

  return out;
}

async function loadAiAnalysisHistory(patientId) {
  const { data, error } = await sb
    .from("ai_analysis_history")
    .select("id, analysis, patient_snapshot, created_at")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

async function renderPatients() {
  const counts = await countsForPatients();
  app.innerHTML = `<div class="topline"><div><h2 style="margin-bottom:2px">Пациенты</h2><div class="muted tiny">Облачная база · ${state.patients.length} пациентов</div></div><button class="btn primary small" id="addPatient">＋ Ребёнок</button></div><div id="flash"></div><div class="patient-list">${state.patients.map(p => `<button class="patient-card" data-pid="${p.id}"><div class="patient-top"><div><div class="name">${esc(p.display_name)}</div><div class="meta">${esc(ageFromDob(p.date_of_birth))} · ${esc(sexLabel(p.sex))}</div></div><span class="badge">активное ведение</span></div><div class="item-sub" style="margin-top:9px">${esc(p.primary_complaint || 'Причина обращения пока не заполнена')}</div><div class="metric-grid"><div class="metric"><b>${counts[p.id]?.goals || 0}</b><span>целей</span></div><div class="metric"><b>${counts[p.id]?.sessions || 0}</b><span>занятий</span></div></div></button>`).join('') || `<div class="card empty">В облачной базе пока нет пациентов.</div>`}</div>`;
  document.getElementById('addPatient').onclick = renderNewPatient;
  document.querySelectorAll('[data-pid]').forEach(b => b.onclick = async () => { state.patientId = b.dataset.pid; state.tab = 'overview'; await loadPatientData(); renderPatient() });
}

function renderNewPatient() {
  app.innerHTML = `<div class="topline"><h2 style="margin:0">Новый ребёнок</h2><button class="link" id="cancel">Отмена</button></div><div id="flash"></div><form class="card" id="patientForm"><label>Имя / псевдоним для теста</label><input name="display_name" required><div class="row"><div><label>Дата рождения</label><input type="date" name="date_of_birth"></div><div><label>Пол</label><select name="sex"><option value="unspecified">Не указано</option><option value="male">Мальчик</option><option value="female">Девочка</option></select></div></div><label>Основная причина обращения</label><textarea name="primary_complaint"></textarea><div class="actions"><button id="patientSaveBtn" class="btn primary full" type="submit">Сохранить в облако</button></div></form>`;
  document.getElementById('cancel').onclick = renderPatients;
  const form = document.getElementById('patientForm'), btn = document.getElementById('patientSaveBtn'); watchFormDirty(form, btn, 'Сохранить в облако');
  form.onsubmit = async e => { e.preventDefault(); setButtonSaving(btn); const fd = new FormData(e.target); const payload = { display_name: fd.get('display_name').trim(), date_of_birth: fd.get('date_of_birth') || null, sex: fd.get('sex'), primary_complaint: fd.get('primary_complaint').trim() || null }; const { data, error } = await sb.from('patients').insert(payload).select().single(); if (error) { setButtonError(btn); return flash('error', error.message) } setButtonSaved(btn); await sleep(650); await loadPatients(); state.patientId = data.id; state.tab = 'overview'; await loadPatientData(); renderPatient() };
}

const currentPatient = () => state.patients.find(p => p.id === state.patientId);
async function loadPatientData() {
  const pid = state.patientId;
  const [g, s, a] = await Promise.all([sb.from('goals').select('*').eq('patient_id', pid).order('created_at', { ascending: false }), sb.from('sessions').select('*').eq('patient_id', pid).order('session_date', { ascending: false }), sb.from('assessments').select('*').eq('patient_id', pid).eq('assessment_type', 'initial').order('created_at', { ascending: false }).limit(1)]);
  if (g.error || s.error || a.error) throw new Error((g.error || s.error || a.error).message); state.goals = g.data || []; state.sessions = s.data || []; state.assessment = (a.data || [])[0] || null;
}
function goalsHtml(goals, deletable = false) {
  if (!goals.length) return `<div class="empty">Целей пока нет.</div>`;
  return goals.map(g => `<div class="goal"><div class="goal-top"><div class="item-title">${esc(g.title)}</div><div class="goal-pct">${g.progress}%</div></div><div class="progress"><span style="width:${Math.max(0, Math.min(100, g.progress))}%"></span></div><div class="item-sub">${esc(g.criterion || 'Критерий не указан')} · ${g.deadline ? fmtDate(g.deadline) : 'срок не указан'}</div>${deletable ? `<button class="link" style="color:#9b3333;margin-top:7px" data-del-goal="${g.id}">Удалить цель</button>` : ''}</div>`).join('');
}
function renderPatient() {
  const p = currentPatient(); if (!p) return renderPatients();
  const tabs = [['overview', 'Обзор'], ['assessment', 'Оценка'], ['goals', 'Цели'], ['sessions', 'Занятия'], ['progress', 'Динамика']];
  app.innerHTML = `<div class="card"><div class="patient-top"><div><div class="muted tiny">Карточка ребёнка</div><h1>${esc(p.display_name)}</h1><div class="meta">${esc(ageFromDob(p.date_of_birth))} · ${esc(sexLabel(p.sex))}</div></div><span class="badge">облако</span></div><div class="sep"></div><div class="item-title">${esc(p.primary_complaint || 'Причина обращения пока не заполнена')}</div><div class="actions"><button class="btn full" id="backPatients">← К пациентам</button></div></div><div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${state.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div><div id="flash"></div><div id="tabContent"></div>`;
  document.getElementById('backPatients').onclick = renderPatients; document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; renderPatient() }); renderTab(p);
  const actions = app.querySelector(".actions");

  const aiBtn = document.createElement("button");
  aiBtn.id = "aiAnalyzeBtn";
  aiBtn.className = "primary";
  aiBtn.textContent = "✨ Анализ ИИ";
  actions.prepend(aiBtn);

  const historyBtn = document.createElement("button");
historyBtn.id = "aiHistoryBtn";
historyBtn.className = "btn";
historyBtn.textContent = "🕘 История анализов";

aiBtn.insertAdjacentElement("afterend", historyBtn);

  const aiResult = document.createElement("div");
  aiResult.className = "card";
  aiResult.style.display = "none";
  aiResult.style.marginTop = "12px";
  aiResult.style.whiteSpace = "pre-wrap";

  const tabContent = document.getElementById("tabContent");
  tabContent.parentNode.insertBefore(aiResult, tabContent);

  if (p.ai_analysis) {
    aiResult.style.display = "block";
    aiResult.innerHTML = formatAIAnalysisBlock(
  p.ai_analysis,
  p.ai_analysis_updated_at
);
    aiBtn.textContent = "✨ Обновить анализ ИИ";
  }

  aiBtn.onclick = async () => {
    aiBtn.disabled = true;
    aiBtn.textContent = "⏳ Анализирую...";
    aiResult.style.display = "block";
    aiResult.textContent = "ИИ анализирует данные ребёнка...";

    try {
      const patientData = {
        age: ageFromDob(p.date_of_birth),
        sex: sexLabel(p.sex),
        complaint: p.primary_complaint || "",
        assessment: state.assessment || null,
        goals: state.goals || [],
        sessions: state.sessions || []
      };

      const prompt = `
Ты — клинический помощник детского физического терапевта.
Проанализируй данные ребёнка кратко, конкретно и только на основании предоставленной информации.

Правила:
- не ставь диагноз по недостаточным данным;
- не выдумывай отсутствующие сведения;
- чётко разделяй факты и предположения;
- если информации недостаточно — прямо укажи это;
- ориентируйся на функцию, активность и участие ребёнка;
- не повторяй одни и те же сведения;
- весь ответ должен быть компактным и пригодным для быстрого чтения специалистом.

Данные ребёнка:
${JSON.stringify(patientData, null, 2)}

Ответ строго по структуре:

## Краткое резюме
Максимум 3 коротких предложения.

## 🔴 Что требует внимания
Только значимые красные флаги, противоречия или важные клинические моменты.
Максимум 4 пункта.
Если ничего существенного нет — так и напиши.

## 🎯 Приоритеты терапии
3–5 наиболее важных функциональных приоритетов.

## 📏 Предлагаемые цели
Предложи 3–5 измеримых функциональных целей.
Не придумывай исходные способности ребёнка, которых нет в данных.

## 🔎 Что ещё нужно уточнить
До 5 наиболее важных недостающих данных или дополнительных оценок.

В конце одной строкой:
**Уверенность анализа:** высокая / средняя / низкая — и коротко почему.
`;

      const answer = await callAI(prompt);

      const analysisUpdatedAt = new Date().toISOString();

      const { error: saveAiError } = await sb
        .from("patients")
        .update({
          ai_analysis: answer,
          ai_analysis_updated_at: analysisUpdatedAt
        })
        .eq("id", p.id);

      if (saveAiError) {
        throw new Error(
          "ИИ выполнил анализ, но сохранить его не удалось: " + saveAiError.message
        );
      }
      const { error: historyError } = await sb
  .from("ai_analysis_history")
  .insert({
    patient_id: p.id,
    therapist_id: user.id,
    analysis: answer,
    patient_snapshot: patientData,
    created_at: analysisUpdatedAt
  });

if (historyError) {
  throw new Error(
    "Анализ сохранён в карточке, но добавить его в историю не удалось: " +
      historyError.message
  );
}

      p.ai_analysis = answer;
      p.ai_analysis_updated_at = analysisUpdatedAt;

    aiResult.innerHTML = formatAIAnalysisBlock(
  answer,
  analysisUpdatedAt
);
      aiBtn.textContent = "✓ Анализ готов";

      setTimeout(() => {
  aiBtn.textContent = p.ai_analysis
    ? "✨ Обновить анализ ИИ"
    : "✨ Анализ ИИ";
  aiBtn.disabled = false;
}, 1200);

    } catch (error) {
      console.error(error);
      aiResult.textContent =
        "Не удалось выполнить анализ ИИ. Попробуйте ещё раз.";

      aiBtn.textContent = "Повторить анализ";
      aiBtn.disabled = false;
    }
  };
}

function option(value, label, current) { return `<option value="${value}" ${String(current ?? '') === String(value) ? 'selected' : ''}>${label}</option>` }
function milestoneRow(key, label, milestones) {
  const m = milestones?.[key] || {};
  return `<div class="milestone"><span>${label}</span><input inputmode="decimal" name="ms_${key}_age" value="${esc(m.age || '')}" placeholder="мес."><select name="ms_${key}_status">${option('achieved', '✓ есть', m.status)}${option('not_yet', '○ нет', m.status)}${option('unknown', '? не помнят', m.status)}</select></div>`;
}
function getStructured(a) { return (a && a.structured_data && typeof a.structured_data === 'object') ? a.structured_data : {} }
function formValue(fd, name) { return String(fd.get(name) || '').trim() }
function milestonesFromForm(fd) {
  const keys = ['head', 'rolls', 'arms', 'sitting', 'quadruped', 'crawl', 'pullstand', 'cruising', 'walking'];
  const out = {}; for (const k of keys) out[k] = { age: formValue(fd, `ms_${k}_age`), status: formValue(fd, `ms_${k}_status`) }; return out;
}

function assessmentHtml(a) {
  const sd = getStructured(a), m = sd.milestones || {}, obs = sd.observation || {}, body = sd.body || {}, ankle = sd.ankle || {}, neuro = sd.neuro || {}, hx = sd.history || {}, compl = sd.complaint || {}, tests = sd.tests || {};
  return `
  <form id="assessmentForm">
    <div class="card">
      <div class="topline"><div><h3 style="margin-bottom:2px">Первичная оценка</h3><div class="muted tiny">Подробная облачная форма v0.6</div></div><span class="badge">${a?.id ? 'сохранена' : 'черновик'}</span></div>

      <div class="section-card">
        <div class="section-head"><div class="section-num">1</div><div class="section-title">Жалоба</div></div>
        <label>Основная жалоба</label><textarea name="complaint">${esc(a?.complaint || '')}</textarea>
        <div class="row"><div><label>Когда впервые заметили?</label><input name="noticed_when" value="${esc(compl.noticed_when || '')}" placeholder="например, 9 мес."></div><div><label>Динамика</label><select name="trend">${option('', 'Не указано', compl.trend)}${option('better', 'Лучше', compl.trend)}${option('same', 'Без изменений', compl.trend)}${option('worse', 'Хуже', compl.trend)}${option('variable', 'Нестабильно', compl.trend)}</select></div></div>
        <label>Что сейчас беспокоит родителей больше всего?</label><textarea name="main_concern">${esc(compl.main_concern || '')}</textarea>
        <label>Категории</label><input name="complaint_categories" value="${esc((compl.categories || []).join(', '))}" placeholder="носочки, стопы, баланс…">
      </div>

      <div class="section-card">
        <div class="section-head"><div class="section-num">2</div><div class="section-title">Беременность, роды, анамнез</div></div>
        <div class="row"><div><label>Беременность по счёту</label><input inputmode="numeric" name="pregnancy_number" value="${esc(hx.pregnancy_number || '')}"></div><div><label>Срок рождения, нед.</label><input inputmode="numeric" name="gestational_age" value="${esc(hx.gestational_age || '')}"></div></div>
        <label>Течение беременности</label><textarea name="pregnancy_history">${esc(a?.pregnancy_history || '')}</textarea>
        <label>Роды / ранний период</label><textarea name="birth_history">${esc(a?.birth_history || '')}</textarea>
        <div class="row"><div><label>Вес при рождении, г</label><input inputmode="numeric" name="birth_weight" value="${esc(hx.birth_weight || '')}"></div><div><label>Apgar</label><input name="apgar" value="${esc(hx.apgar || '')}" placeholder="8 / 9"></div></div>
        <label>Предыдущая реабилитация / физическая терапия</label><textarea name="previous_rehab">${esc(hx.previous_rehab || '')}</textarea>
      </div>

      <div class="section-card">
        <div class="section-head"><div class="section-num">3</div><div class="section-title">Моторное развитие</div></div>
        <div class="help">Возраст появления навыка можно оставить пустым. Статус — «есть / нет / не помнят».</div>
        ${milestoneRow('head', 'Контроль головы', m)}
        ${milestoneRow('rolls', 'Перевороты', m)}
        ${milestoneRow('arms', 'Опора на прямые руки', m)}
        ${milestoneRow('sitting', 'Самостоятельное сидение', m)}
        ${milestoneRow('quadruped', 'Четвереньки', m)}
        ${milestoneRow('crawl', 'Ползание на четвереньках', m)}
        ${milestoneRow('pullstand', 'Вставание у опоры', m)}
        ${milestoneRow('cruising', 'Ходьба вдоль опоры', m)}
        ${milestoneRow('walking', 'Самостоятельная ходьба', m)}
        <label>Комментарий по развитию</label><textarea name="motor_development">${esc(a?.motor_development || '')}</textarea>
      </div>

      <div class="section-card">
        <div class="section-head"><div class="section-num">4</div><div class="section-title">Осмотр и спонтанная моторика</div></div>
        <label>Основная запись осмотра</label><textarea name="observation">${esc(a?.observation || '')}</textarea>
        <div class="row"><div><label>Симметрия</label><select name="symmetry">${option('', 'Не указано', obs.symmetry)}${option('yes', 'Симметрично', obs.symmetry)}${option('no', 'Есть асимметрия', obs.symmetry)}${option('unclear', 'Трудно оценить', obs.symmetry)}</select></div><div><label>Переходы</label><select name="transitions">${option('', 'Не указано', obs.transitions)}${option('free', 'Свободные', obs.transitions)}${option('limited', 'Ограничены', obs.transitions)}</select></div></div>
        <label>Использование сторон</label><select name="side_use">${option('symmetric', 'Симметричное', obs.side_use)}${option('left', 'Преимущественно слева', obs.side_use)}${option('right', 'Преимущественно справа', obs.side_use)}${option('unclear', 'Трудно оценить', obs.side_use)}</select>
      </div>

      <div class="section-card">
        <div class="section-head"><div class="section-num">5</div><div class="section-title">Положение тела</div></div>
        <details open><summary>Голова / шея / плечевой пояс / туловище</summary>
          <label>Голова и шея</label><textarea name="head_neck">${esc(body.head_neck || '')}</textarea>
          <label>Плечевой пояс</label><textarea name="shoulders">${esc(body.shoulders || '')}</textarea>
          <label>Туловище</label><textarea name="trunk">${esc(body.trunk || '')}</textarea>
        </details>
        <details><summary>Таз / тазобедренные / колени</summary>
          <label>Таз</label><textarea name="pelvis">${esc(body.pelvis || '')}</textarea>
          <label>Тазобедренные суставы</label><textarea name="hips">${esc(body.hips || '')}</textarea>
          <label>Колени</label><textarea name="knees">${esc(body.knees || '')}</textarea>
        </details>
        <details><summary>Стопы</summary><label>Описание стоп</label><textarea name="feet">${esc(body.feet || '')}</textarea></details>
      </div>

      <div class="section-card">
        <div class="section-head"><div class="section-num">6</div><div class="section-title">Голеностоп и опора стоп</div></div>
        <div class="row"><div><label>Дорсифлексия R, °</label><input inputmode="decimal" name="df_right" value="${esc(ankle.df_right || '')}"></div><div><label>Дорсифлексия L, °</label><input inputmode="decimal" name="df_left" value="${esc(ankle.df_left || '')}"></div></div>
        <label>Положение колена при измерении</label><select name="knee_position">${option('', 'Не указано', ankle.knee_position)}${option('flexed', 'Согнуто', ankle.knee_position)}${option('extended', 'Разогнуто', ankle.knee_position)}${option('both', 'Оба положения', ankle.knee_position)}</select>
        <div class="row"><div><label>Опора R</label><select name="foot_support_right">${option('', 'Не указано', ankle.foot_support_right)}${option('full', 'Полная стопа', ankle.foot_support_right)}${option('forefoot', 'Передний отдел', ankle.foot_support_right)}${option('other', 'Другое', ankle.foot_support_right)}</select></div><div><label>Опора L</label><select name="foot_support_left">${option('', 'Не указано', ankle.foot_support_left)}${option('full', 'Полная стопа', ankle.foot_support_left)}${option('forefoot', 'Передний отдел', ankle.foot_support_left)}${option('other', 'Другое', ankle.foot_support_left)}</select></div></div>
        <div class="row"><div><label>Пятка R</label><select name="heel_right">${option('', 'Не указано', ankle.heel_right)}${option('neutral', 'Нейтрально', ankle.heel_right)}${option('valgus', 'Вальгус', ankle.heel_right)}${option('varus', 'Варус', ankle.heel_right)}</select></div><div><label>Пятка L</label><select name="heel_left">${option('', 'Не указано', ankle.heel_left)}${option('neutral', 'Нейтрально', ankle.heel_left)}${option('valgus', 'Вальгус', ankle.heel_left)}${option('varus', 'Варус', ankle.heel_left)}</select></div></div>
      </div>

      <div class="section-card">
        <div class="section-head"><div class="section-num">7</div><div class="section-title">Неврологические признаки</div></div>
        <div class="row"><div><label>Тонус рук</label><select name="tone_arms">${option('', 'Не оценён', neuro.tone_arms)}${option('normal', 'Без явных особенностей', neuro.tone_arms)}${option('high', 'Повышен', neuro.tone_arms)}${option('low', 'Снижен', neuro.tone_arms)}${option('asymmetry', 'Асимметрия', neuro.tone_arms)}</select></div><div><label>Тонус ног</label><select name="tone_legs">${option('', 'Не оценён', neuro.tone_legs)}${option('normal', 'Без явных особенностей', neuro.tone_legs)}${option('high', 'Повышен', neuro.tone_legs)}${option('low', 'Снижен', neuro.tone_legs)}${option('asymmetry', 'Асимметрия', neuro.tone_legs)}</select></div></div>
        <label>Сухожильные рефлексы</label><input name="reflexes" value="${esc(neuro.reflexes || '')}">
        <label>Подошвенный ответ</label><input name="plantar" value="${esc(neuro.plantar || '')}">
        <label>Клонус</label><select name="clonus">${option('', 'Не проверял', neuro.clonus)}${option('none', 'Нет', neuro.clonus)}${option('present', 'Есть', neuro.clonus)}</select>
        <label>Другие наблюдения</label><textarea name="neuro_observations">${esc(a?.neuro_observations || '')}</textarea>
      </div>

      <div class="section-card">
        <div class="section-head"><div class="section-num">8</div><div class="section-title">Стандартизированные оценки</div></div>
        <label>Инструмент / шкала</label><input name="test_name" value="${esc(tests.name || '')}" placeholder="например, HINE">
        <label>Результат / комментарий</label><textarea name="test_result">${esc(tests.result || '')}</textarea>
        <div class="help">На следующих этапах отдельные шкалы будут встроены структурированно и только при разрешённом использовании.</div>
      </div>

      <div class="section-card">
        <div class="section-head"><div class="section-num">9</div><div class="section-title">Физиотерапевтическое заключение</div></div>
        <textarea name="conclusion" placeholder="Подтверждается специалистом">${esc(a?.conclusion || '')}</textarea>
      </div>

      <div class="actions">
        <button id="assessmentSaveBtn" class="btn primary full" type="submit">${a?.id ? 'Сохранить изменения' : 'Сохранить оценку в облако'}</button>
      </div>
      <div id="assessmentSaveStatus" class="save-status"></div>
    </div>
  </form>`;
}

function structuredFromAssessmentForm(fd) {
  const categories = formValue(fd, 'complaint_categories').split(',').map(x => x.trim()).filter(Boolean);
  return {
    complaint: { noticed_when: formValue(fd, 'noticed_when'), trend: formValue(fd, 'trend'), main_concern: formValue(fd, 'main_concern'), categories },
    history: { pregnancy_number: formValue(fd, 'pregnancy_number'), gestational_age: formValue(fd, 'gestational_age'), birth_weight: formValue(fd, 'birth_weight'), apgar: formValue(fd, 'apgar'), previous_rehab: formValue(fd, 'previous_rehab') },
    milestones: milestonesFromForm(fd),
    observation: { symmetry: formValue(fd, 'symmetry'), transitions: formValue(fd, 'transitions'), side_use: formValue(fd, 'side_use') },
    body: { head_neck: formValue(fd, 'head_neck'), shoulders: formValue(fd, 'shoulders'), trunk: formValue(fd, 'trunk'), pelvis: formValue(fd, 'pelvis'), hips: formValue(fd, 'hips'), knees: formValue(fd, 'knees'), feet: formValue(fd, 'feet') },
    ankle: { df_right: formValue(fd, 'df_right'), df_left: formValue(fd, 'df_left'), knee_position: formValue(fd, 'knee_position'), foot_support_right: formValue(fd, 'foot_support_right'), foot_support_left: formValue(fd, 'foot_support_left'), heel_right: formValue(fd, 'heel_right'), heel_left: formValue(fd, 'heel_left') },
    neuro: { tone_arms: formValue(fd, 'tone_arms'), tone_legs: formValue(fd, 'tone_legs'), reflexes: formValue(fd, 'reflexes'), plantar: formValue(fd, 'plantar'), clonus: formValue(fd, 'clonus') },
    tests: { name: formValue(fd, 'test_name'), result: formValue(fd, 'test_result') }
  };
}

function renderTab(p) {
  const box = document.getElementById('tabContent');
  if (state.tab === 'overview') {
    box.innerHTML = `<div class="card"><h3>Сводка</h3><div class="metric-grid"><div class="metric"><b>${state.goals.filter(g => g.status === 'active').length}</b><span>активных целей</span></div><div class="metric"><b>${state.sessions.length}</b><span>занятий</span></div></div><div class="actions"><button class="btn primary" id="goSession">＋ Занятие</button><button class="btn" id="goGoal">＋ Цель</button></div></div><div class="card"><h3>Последнее занятие</h3>${state.sessions[0] ? `<div class="item-title">${fmtDate(state.sessions[0].session_date)} · ${esc(toleranceLabel(state.sessions[0].tolerance))}</div><div class="item-sub">${esc(state.sessions[0].note || '')}</div>` : `<div class="empty">Занятий пока нет.</div>`}</div><div class="card"><h3>Текущие цели</h3>${goalsHtml(state.goals)}</div>`;
    document.getElementById('goSession').onclick = () => { state.tab = 'sessions'; renderPatient() };
    document.getElementById('goGoal').onclick = () => { state.tab = 'goals'; renderPatient() };
  }
  if (state.tab === 'assessment') {
    box.innerHTML = assessmentHtml(state.assessment);
    const form = document.getElementById('assessmentForm'), btn = document.getElementById('assessmentSaveBtn'), status = document.getElementById('assessmentSaveStatus');
    watchFormDirty(form, btn, state.assessment?.id ? 'Сохранить изменения' : 'Сохранить оценку в облако');
    form.onsubmit = async e => {
      e.preventDefault(); setButtonSaving(btn); status.textContent = '';
      const fd = new FormData(form);
      const payload = {
        patient_id: p.id,
        assessment_type: 'initial',
        complaint: formValue(fd, 'complaint') || null,
        pregnancy_history: formValue(fd, 'pregnancy_history') || null,
        birth_history: formValue(fd, 'birth_history') || null,
        motor_development: formValue(fd, 'motor_development') || null,
        observation: formValue(fd, 'observation') || null,
        neuro_observations: formValue(fd, 'neuro_observations') || null,
        conclusion: formValue(fd, 'conclusion') || null,
        structured_data: structuredFromAssessmentForm(fd)
      };
      const r = state.assessment?.id ? await sb.from('assessments').update(payload).eq('id', state.assessment.id).select().single() : await sb.from('assessments').insert(payload).select().single();
      if (r.error) { setButtonError(btn); status.textContent = ''; return flash('error', r.error.message) }
      state.assessment = r.data; setButtonSaved(btn); status.textContent = '✓ Данные сохранены в облаке';
    };
  }
  if (state.tab === 'goals') {
    box.innerHTML = `<div class="card"><h3>Активные цели</h3>${goalsHtml(state.goals, true)}</div><form class="card" id="goalForm"><h3>＋ Новая цель</h3><label>Функциональная цель</label><textarea name="title" required></textarea><label>Исходное состояние</label><textarea name="baseline"></textarea><label>Критерий достижения</label><input name="criterion"><label>Срок</label><input type="date" name="deadline"><label>Прогресс</label><select name="progress"><option value="0">0%</option><option value="20">20%</option><option value="40">40%</option><option value="60">60%</option><option value="80">80%</option><option value="100">100%</option></select><div class="actions"><button id="goalSaveBtn" class="btn primary full" type="submit">Добавить цель</button></div><div id="goalStatus" class="save-status"></div></form>`;
    const form = document.getElementById('goalForm'), btn = document.getElementById('goalSaveBtn'), status = document.getElementById('goalStatus'); watchFormDirty(form, btn, 'Добавить цель');
    form.onsubmit = async e => { e.preventDefault(); setButtonSaving(btn); const fd = new FormData(e.target), payload = { patient_id: p.id, title: fd.get('title').trim(), baseline: fd.get('baseline').trim() || null, criterion: fd.get('criterion').trim() || null, deadline: fd.get('deadline') || null, progress: Number(fd.get('progress')), status: 'active' }; const { error } = await sb.from('goals').insert(payload); if (error) { setButtonError(btn, 'Добавить цель'); return flash('error', error.message) } setButtonSaved(btn, '✓ Цель сохранена'); status.textContent = '✓ Данные сохранены в облаке'; await sleep(700); await loadPatientData(); renderPatient() };
    document.querySelectorAll('[data-del-goal]').forEach(b => b.onclick = async () => { const { error } = await sb.from('goals').delete().eq('id', b.dataset.delGoal); if (error) return flash('error', error.message); await loadPatientData(); renderPatient() });
  }
  if (state.tab === 'sessions') {
    box.innerHTML = `<form class="card" id="sessionForm"><h3>＋ Новое занятие</h3><label>Дата</label><input type="date" name="session_date" value="${new Date().toISOString().slice(0, 10)}"><label>Запись занятия</label><textarea name="note" required></textarea><label>Переносимость</label><select name="tolerance"><option value="good">Хорошая</option><option value="medium">Средняя</option><option value="low">Низкая</option><option value="unclear">Трудно оценить</option></select><div class="actions"><button id="sessionSaveBtn" class="btn primary full" type="submit">Сохранить занятие</button></div><div id="sessionStatus" class="save-status"></div></form><div class="card"><h3>История занятий</h3>${state.sessions.map(s => `<div class="item"><div class="item-title">${fmtDate(s.session_date)} · ${esc(toleranceLabel(s.tolerance))}</div><div class="item-sub">${esc(s.note || '')}</div><button class="link" style="color:#9b3333;margin-top:7px" data-del-session="${s.id}">Удалить</button></div>`).join('') || `<div class="empty">Занятий пока нет.</div>`}</div>`;
    const form = document.getElementById('sessionForm'), btn = document.getElementById('sessionSaveBtn'), status = document.getElementById('sessionStatus'); watchFormDirty(form, btn, 'Сохранить занятие');
    form.onsubmit = async e => { e.preventDefault(); setButtonSaving(btn); const fd = new FormData(e.target), payload = { patient_id: p.id, session_date: fd.get('session_date'), note: fd.get('note').trim(), tolerance: fd.get('tolerance') }; const { error } = await sb.from('sessions').insert(payload); if (error) { setButtonError(btn, 'Сохранить занятие'); return flash('error', error.message) } setButtonSaved(btn, '✓ Занятие сохранено'); status.textContent = '✓ Данные сохранены в облаке'; await sleep(700); await loadPatientData(); renderPatient() };
    document.querySelectorAll('[data-del-session]').forEach(b => b.onclick = async () => { const { error } = await sb.from('sessions').delete().eq('id', b.dataset.delSession); if (error) return flash('error', error.message); await loadPatientData(); renderPatient() });
  }
  if (state.tab === 'progress') {
    box.innerHTML = `<div class="card"><h3>Динамика по целям</h3>${state.goals.length ? state.goals.map(g => `<div class="goal"><div class="goal-top"><div class="item-title">${esc(g.title)}</div><div class="goal-pct">${g.progress}%</div></div><div class="progress"><span style="width:${Math.max(0, Math.min(100, g.progress))}%"></span></div><div class="item-sub">${esc(g.criterion || 'Критерий не указан')} · ${g.deadline ? fmtDate(g.deadline) : 'срок не указан'}</div></div>`).join('') : `<div class="empty">Нет целей для динамики.</div>`}</div><div class="card"><div class="metric-grid"><div class="metric"><b>${state.sessions.length}</b><span>занятий</span></div><div class="metric"><b>${state.goals.filter(g => g.progress >= 100).length}</b><span>целей 100%</span></div></div></div>`;
  }
}

init().catch(err => { app.innerHTML = `<div class="error">Ошибка запуска приложения: ${esc(err.message)}</div>` });
