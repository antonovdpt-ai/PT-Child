
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';
import { escapeHtml, safeSameOriginHttpsUrl } from './security-utils.mjs';
import { shouldRenderAuthEvent } from './auth-domain.mjs?v=1';
import { createSpecialistRoleGate } from './role-gate.mjs';
import { mountParentReportWorkspace, leaveParentReportWorkspace } from './parent-report-workspace.mjs?v=2';
import { renderParentPortalSpecialist, renderParentSessionReportEditor } from './parent-specialist.js?v=8';
import { renderCabinet } from './cabinet.js?v=8';
import { patientFlowerHtml, mountPatientFlower, readFlowerCompact, saveFlowerCompact, collapsePatientFlower } from './patient-flower.mjs?v=1';
import { patientOverviewHtml, mountPatientOverview, updateOverviewReport } from './patient-overview.mjs?v=1';
import { openScheduleEditor } from './schedule-editor.js?v=8';

const SUPABASE_URL = "https://auth.fizira.com";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg5NjU2NzI5LCJleHAiOjE5NDczMzY3Mjl9.gWkGsKODazY419TdwTGoSL9InQK3Yzt5YYC7UGVFllo";

// Сохраняем режим восстановления до обработки ссылки Supabase.
const RECOVERY_STORAGE_KEY = 'ptchild-password-recovery';

let passwordRecoveryActive =
  new URLSearchParams(window.location.hash.slice(1))
    .get('type') === 'recovery';

try {
  passwordRecoveryActive =
    passwordRecoveryActive ||
    sessionStorage.getItem(RECOVERY_STORAGE_KEY) === '1';
} catch (_) {}

function setPasswordRecovery(active) {
  passwordRecoveryActive = active;

  try {
    if (active) {
      sessionStorage.setItem(RECOVERY_STORAGE_KEY, '1');
    } else {
      sessionStorage.removeItem(RECOVERY_STORAGE_KEY);
    }
  } catch (_) {}
}

if (passwordRecoveryActive) {
  setPasswordRecovery(true);
}

const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const app = document.getElementById('app');
const headerActions = document.getElementById('headerActions');
let session = null, user = null;
let currentRoles = new Set();
const roleGate = createSpecialistRoleGate({
  sb,
  setReady(ready) {
    document.body.dataset.specialistReady = ready ? 'true' : 'false';
    document.body.classList.toggle('is-authenticated', ready);
    document.querySelectorAll('.sidebar-nav-item').forEach(button => { button.disabled = !ready; });
  },
  redirect: route => window.location.replace(route)
});
async function loadCurrentRoles() {
  currentRoles = await roleGate.loadCurrentRoles();
  return currentRoles;
}
const createEmptyState = () => ({
  patientId: null,
  tab: 'overview',
  patients: [],
  goals: [],
  sessions: [],
  assessment: null,
  profile: null,
  contacts: [],
  parentReports: [],
  parentSessionReports: [],
  aiDocumentIdsByPatient: {}
});
let state = createEmptyState();

const esc = escapeHtml;
const safeStorageUrl = value =>
  safeSameOriginHttpsUrl(value, SUPABASE_URL);
const fmtDate = v => { if (!v) return 'дата не указана'; const d = new Date(v + 'T12:00:00'); return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) };
const ageFromDob = dob => {
  if (!dob) return 'Возраст не указан';

  const b = new Date(dob + 'T12:00:00');
  const n = new Date();

  let m =
    (n.getFullYear() - b.getFullYear()) * 12 +
    n.getMonth() -
    b.getMonth();

  if (n.getDate() < b.getDate()) m--;

  if (m < 24) return `${m} мес.`;

  const y = Math.floor(m / 12);
  const r = m % 12;

  const yearWord =
    y === 1
      ? 'год'
      : y >= 2 && y <= 4
        ? 'года'
        : 'лет';

  return r
    ? `${y} ${yearWord} ${r} мес.`
    : `${y} ${yearWord}`;
};
const sexLabel = v => v === 'male' ? 'Мальчик' : v === 'female' ? 'Девочка' : 'Не указано';
const toleranceLabel = v => ({ good: 'Хорошая', medium: 'Средняя', low: 'Низкая', unclear: 'Трудно оценить' }[v] || 'Не указана');

const dynamicsLabel = v => ({
  improved: 'Улучшение',
  stable: 'Без значимых изменений',
  worse: 'Ухудшение',
  unclear: 'Трудно оценить'
}[v] || 'Не указано');

function sessionDynamicsHtml(s) {
  const dynamics = s.dynamics_status
    ? `<div class="item-sub"><b>Динамика:</b> ${esc(dynamicsLabel(s.dynamics_status))}</div>`
    : '';

  const changes = s.function_changes
    ? `<div class="item-sub"><b>Изменения функции:</b> ${esc(s.function_changes)}</div>`
    : '';

  return dynamics + changes;
}

function plannedSessionHtml(plan) {
  if (!plan || typeof plan !== 'object') return '';

  const workBlocks = Array.isArray(plan.work_blocks)
    ? plan.work_blocks
    : [];

  const whatToTrack = Array.isArray(plan.what_to_track)
    ? plan.what_to_track
    : [];

  return `
    <details style="margin-top:12px">
      <summary
        class="item-title"
        style="cursor:pointer"
      >
        📋 План этого занятия
      </summary>

      ${
        plan.main_task
          ? `
            <div class="item-sub" style="margin-top:10px">
              <b>🎯 Главная задача:</b><br>
              ${esc(plan.main_task)}
            </div>
          `
          : ''
      }

      ${
        plan.start_check?.action
          ? `
            <div class="item-sub" style="margin-top:10px">
              <b>👀 Проверить в начале:</b><br>
              ${esc(plan.start_check.action)}
            </div>
          `
          : ''
      }

      ${workBlocks
        .map(
          (block, index) => `
            <div class="item-sub" style="margin-top:10px">
              <b>${index + 1}. ${esc(block.title || 'Рабочий блок')}</b><br>
              ${esc(block.action || '')}
            </div>
          `
        )
        .join('')}

      ${
        whatToTrack.length
          ? `
            <div class="item-sub" style="margin-top:10px">
              <b>📌 Что планировали отслеживать:</b>
              <ul>
                ${whatToTrack
                  .map(item => `<li>${esc(item)}</li>`)
                  .join('')}
              </ul>
            </div>
          `
          : ''
      }
    </details>
  `;
}

function flash(type, msg) { const el = document.getElementById('flash'); if (el) el.innerHTML = `<div class="${type}">${esc(msg)}</div>` }

async function callAI(operation, patientId, input = {}, files = []) {
  const cleanOperation = String(operation || "").trim();
  const cleanPatientId = String(patientId || "").trim();

  if (!cleanOperation || !cleanPatientId) {
    throw new Error("Не указан контекст запроса к ИИ");
  }

  const { data, error } = await sb.functions.invoke("ptchild-ai", {
  body: {
    operation: cleanOperation,
    patient_id: cleanPatientId,
    input,
    files: files
  }
});

  if (error) {
    throw error;
  }

  if (!data?.text) {
    throw new Error("ИИ не вернул ответ");
  }

  return data.text;
}

// Keep these two pure validators identical to the Edge contract; parity is tested.
function validateNextSessionPlan(plan) {
  const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 12000;
  const list = value => Array.isArray(value) && value.length > 0 && value.every(text);
  const placeholder = value => /^\s*(?:\d+[.)]?\s*)?рабочий блок(?:\s*\d+)?[.\s]*$/i.test(value);
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) ||
      !text(plan.main_task) || !text(plan.start_check?.action) ||
      !Array.isArray(plan.work_blocks) || !plan.work_blocks.length || plan.work_blocks.length > 8 ||
      !plan.work_blocks.every(block => block && text(block.title) && !placeholder(block.title) &&
        text(block.action) && !placeholder(block.action) && text(block.why) && text(block.progress_if)) ||
      !list(plan.what_to_track) || !list(plan.session_success_criteria)) {
    throw new Error('ИИ вернул неполный план. Повторите подготовку: нужны содержательные рабочие блоки и критерии проверки.');
  }
  return plan;
}

function validateSessionDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft) ||
      typeof draft.session_note !== 'string' || !draft.session_note.trim() ||
      ![null, '', 'good', 'medium', 'low', 'unclear'].includes(draft.tolerance) ||
      ![null, '', 'improved', 'stable', 'worse', 'unclear'].includes(draft.dynamics_status) ||
      typeof draft.function_changes !== 'string' || !Array.isArray(draft.goal_updates)) {
    throw new Error('ИИ вернул некорректный черновик. Повторите разбор; введённые данные сохранены в форме.');
  }
  return draft;
}


async function analyzeSessionDraft({
  patientId,
  transcript
}) {
  const text = await callAI("session_draft", patientId, { transcript });

  const cleaned = String(text)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  return validateSessionDraft(JSON.parse(cleaned));
}

async function prepareNextSessionPlan(patientId) {
  const text = await callAI("next_session_plan", patientId);

  const cleaned = String(text)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const result = JSON.parse(cleaned);
  return validateNextSessionPlan(result);
}

function buildNextSessionContext(p) {
  const activeGoals = state.goals
    .filter(goal => goal.status === 'active')
    .map(goal => ({
      title: goal.title,
      baseline: goal.baseline || null,
      criterion: goal.criterion || null,
      progress: Number(goal.progress ?? 0)
    }));

  const recentSessions = state.sessions
    .slice(0, 3)
    .map(session => ({
      date: session.session_date,
      note: session.note || null,
      tolerance: session.tolerance || null,
      dynamics_status: session.dynamics_status || null,
      function_changes: session.function_changes || null
    }));

  const assessment = state.assessment
    ? {
        motor_development:
          state.assessment.motor_development || null,
        observation:
          state.assessment.observation || null,
        neuro_observations:
          state.assessment.neuro_observations || null,
        conclusion:
          state.assessment.conclusion || null
      }
    : null;

  return {
    age: ageFromDob(p.date_of_birth),
    primary_complaint:
      p.primary_complaint || null,
    active_goals: activeGoals,
    recent_sessions: recentSessions,
    assessment
  };
}

function buildParentReportContext(p) {
  const goals = (state.goals || []).map(goal => ({
    title: goal.title || null,
    baseline: goal.baseline || null,
    criterion: goal.criterion || null,
    progress: Number(goal.progress ?? 0),
    status: goal.status || null
  }));

  const recentSessions = (state.sessions || [])
    .slice(0, 5)
    .map(session => ({
      date: session.session_date || null,
      note: session.note || null,
      tolerance: session.tolerance || null,
      dynamics_status: session.dynamics_status || null,
      function_changes: session.function_changes || null
    }));

  const assessment = state.assessment
    ? {
        motor_development:
          state.assessment.motor_development || null,

        observation:
          state.assessment.observation || null,

        neuro_observations:
          state.assessment.neuro_observations || null,

        conclusion:
          state.assessment.conclusion || null
      }
    : null;

  return {
    age: ageFromDob(p.date_of_birth),
    primary_complaint: p.primary_complaint || null,
    assessment,
    goals,
    recent_sessions: recentSessions
  };
}

function buildGeneralAnalysisContext(
  p,
  documents = []
) {
  const assessment = state.assessment
    ? {
        assessment_type:
          state.assessment.assessment_type || null,
        assessment_date:
          state.assessment.assessment_date || null,
        complaint:
          state.assessment.complaint || null,
        pregnancy_history:
          state.assessment.pregnancy_history || null,
        birth_history:
          state.assessment.birth_history || null,
        motor_development:
          state.assessment.motor_development || null,
        observation:
          state.assessment.observation || null,
        neuro_observations:
          state.assessment.neuro_observations || null,
        conclusion:
          state.assessment.conclusion || null,
        structured_data:
          state.assessment.structured_data || {}
      }
    : null;

  const goals = (state.goals || []).map(goal => ({
    title: goal.title || null,
    baseline: goal.baseline || null,
    criterion: goal.criterion || null,
    deadline: goal.deadline || null,
    progress: Number(goal.progress ?? 0),
    status: goal.status || null
  }));

  const sessions = (state.sessions || []).map(session => ({
    date: session.session_date || null,
    note: session.note || null,
    tolerance: session.tolerance || null,
    dynamics_status: session.dynamics_status || null,
    function_changes: session.function_changes || null,
    planned_session: session.planned_session || null
  }));

  return {
    age: ageFromDob(p.date_of_birth),
    sex: sexLabel(p.sex),
    complaint: p.primary_complaint || '',
    assessment,
    goals,
    sessions,
    documents
  };
}

async function prepareParentReportDraft(patientId) {
  const text = await callAI("parent_report_draft", patientId);

  const cleaned = String(text)
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const result = JSON.parse(cleaned);

  if (!result || typeof result !== 'object') {
    throw new Error(
      'ИИ вернул некорректный черновик отчёта'
    );
  }

  return result;
}

async function openParentReportPrintView(
  p,
  report,
  therapistName = '',
  therapistProfession = '',
  therapistOrganization = '',
  therapistPhone = '',
  therapistLogoPath = ''
) {
  const printWindow = window.open('', '_blank');

  if (!printWindow) {

    alert(
      'Браузер заблокировал окно отчёта. Разреши всплывающие окна для Fizira.'
    );
    return;
  }
  const therapistLogoUrl =
  await getSpecialistLogoUrl(
    therapistLogoPath
  );

  const sectionHtml = (title, text) => {
    const value = String(text || '').trim();

    if (!value) return '';

    return `
      <section>
        <h2>${esc(title)}</h2>
        <div class="text">
          ${esc(value).replace(/\n/g, '<br>')}
        </div>
      </section>
    `;
  };

  const reportDate =
    new Date().toLocaleDateString('ru-RU');

    const fileDate =
  new Date().toISOString().slice(0, 10);

const safeChildName = String(
  p.display_name || 'Ребёнок'
)
  .trim()
  .replace(/[\\/:*?"<>|]+/g, '')
  .replace(/\s+/g, '_');

const pdfFileName =
  `${safeChildName}_отчет_${fileDate}`;

  const childAge =
    ageFromDob(p.date_of_birth);

  printWindow.document.write(`
    <!doctype html>
    <html lang="ru">
      <head>
        <meta charset="UTF-8">

        <title>${esc(pdfFileName)}</title>

        <style>
          @page {
            size: A4;
            margin: 18mm;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            font-family:
              Arial,
              Helvetica,
              sans-serif;
            color: #1f2937;
            font-size: 12.5pt;
            line-height: 1.5;
          }

          .header {
            border-bottom: 2px solid #2563eb;
            padding-bottom: 14px;
            margin-bottom: 24px;
          }

          .brand {
            font-size: 13px;
            color: #64748b;
            margin-bottom: 4px;
          }

          h1 {
            margin: 0;
            font-size: 24px;
            color: #111827;
          }

          .meta {
            margin-top: 8px;
            color: #64748b;
            font-size: 11pt;
          }

          section {
            margin-bottom: 22px;
            page-break-inside: avoid;
          }

          h2 {
            margin: 0 0 8px;
            font-size: 15px;
            color: #1d4ed8;
          }

          .text {
            white-space: normal;
          }

          .disclaimer {
            margin-top: 30px;
            padding-top: 14px;
            border-top: 1px solid #d1d5db;
            color: #6b7280;
            font-size: 9.5pt;
          }

          .footer {
            margin-top: 12px;
            color: #9ca3af;
            font-size: 9pt;
          }

          @media print {
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          }
        </style>
      </head>

      <body>
        <div class="header">
          <div class="brand">
            Fizira · Отчёт для родителя
          </div>

          <h1>
            ${esc(p.display_name || 'Ребёнок')}
          </h1>

          <div class="meta">
  ${
    childAge
      ? `Возраст: ${esc(childAge)} · `
      : ''
  }
  Дата отчёта: ${esc(reportDate)}

  ${
  therapistLogoUrl
    ? `
      <div
        style="
          float:right;
          margin-left:20px;
          margin-bottom:8px;
          text-align:right;
        "
      >
        <img
          src="${esc(therapistLogoUrl)}"
          alt="Логотип"
          style="
            max-width:100px;
            max-height:55px;
            object-fit:contain;
            display:block;
          "
        >
      </div>
    `
    : ''
}

${
  therapistName
    ? `<br>Специалист: ${esc(therapistName)}`
    : ''
}

${
  therapistProfession
    ? `<br>${esc(therapistProfession)}`
    : ''
}

${
  therapistOrganization
    ? `<br>${esc(therapistOrganization)}`
    : ''
}

${
  therapistPhone
    ? `<br>Телефон: ${esc(therapistPhone)}`
    : ''
}

</div>
        </div>

        ${sectionHtml(
          'С чем обратились',
          report.complaint
        )}

        ${sectionHtml(
          'Что ребёнок сейчас умеет',
          report.strengths
        )}

        ${sectionHtml(
          'На что мы обратили внимание',
          report.observations
        )}

        ${sectionHtml(
          'Над чем будем работать',
          report.goals
        )}

        ${sectionHtml(
          'Динамика',
          report.progress
        )}

        ${sectionHtml(
          'Рекомендации домой',
          report.recommendations
        )}

        <div class="disclaimer">
          Отчёт отражает результаты физиотерапевтической
          оценки и работы специалиста и не заменяет
          медицинское заключение врача.
        </div>

        <div class="footer">
          Сформировано в Fizira
        </div>
      </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();

  setTimeout(() => {
    printWindow.print();
  }, 300);
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

function formatAIAnalysisBlock(text, updatedAt, label = "Последний анализ ИИ") {
  const dateText = formatAIAnalysisDate(updatedAt);

  const dateHtml = dateText
    ? `<div class="muted tiny" style="margin-bottom:10px">
        ${esc(label)}: ${esc(dateText)}
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

function renderHeader() {
  if (passwordRecoveryActive || !user) {
    headerActions.innerHTML = '';
    return;
  }

 headerActions.innerHTML = `
  <div class="header-user">
    <div class="header-user-email">
      ${esc(user.email || '')}
    </div>

    <div class="header-user-actions">
      <button
        id="profileBtn"
        type="button"
        class="btn account-button"
      >
        Профиль
      </button>

      <button
        id="logoutBtn"
        type="button"
        class="link logout-button"
        aria-label="Выйти из аккаунта"
        title="Выйти"
      >
        <span class="logout-label">Выйти</span>
        <svg class="logout-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H13"/><path d="M12 12h8"/><path d="m17 8 4 4-4 4"/></svg>
      </button>
    </div>
  </div>
`;

async function openSchedule() {
  if (!roleGate.canNavigate()) return;
  const revision = authViewRevision, userId = user?.id;
  const isCurrent = () => revision === authViewRevision && userId === user?.id && roleGate.canNavigate();
  if (!await leaveParentReportWorkspace(app) || !isCurrent()) return;
  renderCabinet({ app, sb, state, user, esc, renderPatients, renderProfile, isCurrent }).catch(error => {
    if (!isCurrent()) return;
    console.error('Ошибка личного кабинета:', error);
    flash('error', error.message || 'Не удалось открыть личный кабинет.');
  });
}

function openProfile() {
  if (!roleGate.canNavigate()) return;
  renderProfile();
}

window.fiziraNavigate = route => {
  if (!roleGate.canNavigate()) return;
  if (route === 'schedule') return openSchedule();
  if (route === 'profile') return openProfile();
  return renderPatients();
};

document.getElementById('profileBtn').onclick = openProfile;

  document.getElementById('logoutBtn').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.setAttribute('aria-label', 'Выхожу из аккаунта');
    button.querySelector('.logout-label')?.replaceChildren('Выхожу…');

    const { error } = await sb.auth.signOut();

    if (error) {
      button.disabled = false;
      button.setAttribute('aria-label', 'Выйти из аккаунта');
      button.querySelector('.logout-label')?.replaceChildren('Выйти');
      flash('error', `Не удалось выйти: ${error.message}`);
    }
  };
}

function setButtonSaving(btn, text = 'Сохраняю…') { btn.disabled = true; btn.classList.remove('saved'); btn.classList.add('saving'); btn.textContent = text }
function setButtonSaved(btn, text = '✓ Сохранено') { if (btn.form) delete btn.form.dataset.dirty; btn.disabled = true; btn.classList.remove('saving'); btn.classList.add('saved'); btn.textContent = text }
function setButtonDirty(btn, text = 'Сохранить изменения') { btn.disabled = false; btn.classList.remove('saving', 'saved'); btn.classList.add('primary'); btn.textContent = text }
function setButtonError(btn, text = 'Повторить сохранение') { btn.disabled = false; btn.classList.remove('saving', 'saved'); btn.classList.add('primary'); btn.textContent = text }
function watchFormDirty(form, btn, dirtyText = 'Сохранить изменения') {
  const mark = () => { form.dataset.dirty = 'true'; setButtonDirty(btn, dirtyText); };
  form.addEventListener('input', mark); form.addEventListener('change', mark);
}
window.addEventListener('beforeunload', event => {
  if (!document.querySelector('form[data-dirty="true"]')) return;
  event.preventDefault();
  event.returnValue = '';
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

function enableVoiceInput(root) {
  if (!root) return;

  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    const note = document.createElement('div');
    note.className = 'muted tiny';
    note.style.marginBottom = '12px';
    note.textContent =
      '🎙 Голосовой ввод не поддерживается этим браузером.';
    root.prepend(note);
    return;
  }

  const fields = root.querySelectorAll(
    'textarea, input[type="text"]'
  );

  fields.forEach(field => {
    if (field.dataset.voiceReady === '1') return;
    if (field.disabled || field.readOnly) return;

    field.dataset.voiceReady = '1';

    const wrapper = document.createElement('div');

    wrapper.style.position = 'relative';
    wrapper.style.width = '100%';

    field.parentNode.insertBefore(wrapper, field);
    wrapper.appendChild(field);

    field.style.width = '100%';
    field.style.boxSizing = 'border-box';
    field.style.paddingRight = '52px';

    const voiceBtn =
      document.createElement('button');

    voiceBtn.type = 'button';
    voiceBtn.textContent = '🎙️';
    voiceBtn.title = 'Голосовой ввод';
    voiceBtn.setAttribute(
      'aria-label',
      'Голосовой ввод'
    );

    voiceBtn.style.position = 'absolute';
    voiceBtn.style.right = '9px';
    voiceBtn.style.width = '36px';
    voiceBtn.style.height = '36px';
    voiceBtn.style.padding = '0';
    voiceBtn.style.margin = '0';
    voiceBtn.style.border = '1px solid #d1d5db';
    voiceBtn.style.borderRadius = '50%';
    voiceBtn.style.background = '#ffffff';
    voiceBtn.style.cursor = 'pointer';
    voiceBtn.style.fontSize = '18px';
    voiceBtn.style.lineHeight = '1';
    voiceBtn.style.display = 'flex';
    voiceBtn.style.alignItems = 'center';
    voiceBtn.style.justifyContent = 'center';
    voiceBtn.style.zIndex = '2';

    if (field.tagName === 'TEXTAREA') {
      voiceBtn.style.bottom = '9px';
    } else {
      voiceBtn.style.top = '50%';
      voiceBtn.style.transform =
        'translateY(-50%)';
    }

    wrapper.appendChild(voiceBtn);

    let recognition = null;
    let listening = false;

    let baseText = '';
    let recognizedText = '';
    let recognitionError = false;

    const resetButton = () => {
      voiceBtn.textContent = '🎙️';
      voiceBtn.title = 'Голосовой ввод';
      voiceBtn.style.background = '#ffffff';
    };

    voiceBtn.onclick = () => {
      if (listening && recognition) {
        voiceBtn.textContent = '⏳';
        voiceBtn.title = 'Завершаю запись';
        recognition.stop();
        return;
      }

      recognition =
        new SpeechRecognition();

      recognition.lang = 'ru-RU';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      baseText = field.value.trim();
      recognizedText = '';
      recognitionError = false;

      recognition.onstart = () => {
        listening = true;

        voiceBtn.textContent = '🔴';
        voiceBtn.title =
          'Идёт запись. Нажмите для остановки';
        voiceBtn.style.background = '#fff1f2';
      };

      recognition.onresult = event => {
        const parts = [];

        for (
          let i = 0;
          i < event.results.length;
          i++
        ) {
          const text =
            event.results[i]?.[0]
              ?.transcript
              ?.trim();

          if (text) {
            parts.push(text);
          }
        }

        recognizedText =
          parts.join(' ').trim();

        if (!recognizedText) return;

        field.value = baseText
          ? `${baseText} ${recognizedText}`
          : recognizedText;

        field.dispatchEvent(
          new Event('input', {
            bubbles: true
          })
        );
      };

      recognition.onerror = event => {
        console.error(
          'Voice recognition error:',
          event.error
        );

        recognitionError = true;

        voiceBtn.textContent = '⚠️';

        if (event.error === 'not-allowed') {
          voiceBtn.title =
            'Нет доступа к микрофону';
        } else if (
          event.error === 'no-speech'
        ) {
          voiceBtn.title =
            'Речь не распознана';
        } else {
          voiceBtn.title =
            'Не удалось распознать речь';
        }
      };

      recognition.onend = () => {
        listening = false;

        if (
          !recognitionError &&
          recognizedText
        ) {
          voiceBtn.textContent = '✓';
          voiceBtn.title =
            'Текст добавлен';

          setTimeout(
            resetButton,
            900
          );
        } else if (
          !recognitionError
        ) {
          voiceBtn.textContent = '⚠️';
          voiceBtn.title =
            'Речь не распознана';

          setTimeout(
            resetButton,
            1200
          );
        } else {
          setTimeout(
            resetButton,
            1500
          );
        }
      };

      try {
        recognition.start();
      } catch (error) {
        console.error(error);

        listening = false;
        voiceBtn.textContent = '⚠️';
        voiceBtn.title =
          'Не удалось запустить микрофон';

        setTimeout(
          resetButton,
          1500
        );
      }
    };
  });
}

function enableAssessmentSectionCollapse(form) {
  if (!form) return;

  const sections =
    form.querySelectorAll('.section-card');

  const completion =
    form.querySelector('#assessmentSectionProgress');

  const updateCompletion = () => {
    if (!completion) return;

    const filled =
      Array.from(sections).filter(section =>
        section.dataset.hasData === '1'
      ).length;

    completion.textContent =
      `Заполнено разделов: ${filled} из ${sections.length}`;
  };

  sections.forEach((section, index) => {
    if (
      section.dataset.collapsibleReady === '1'
    ) {
      return;
    }

    const head =
      section.querySelector(':scope > .section-head');

    if (!head) return;

    section.dataset.collapsibleReady = '1';
    section.classList.add('assessment-section');

    const body =
      document.createElement('div');

    body.className =
      'assessment-section-body';

    while (head.nextSibling) {
      body.appendChild(head.nextSibling);
    }

    section.appendChild(body);

    head.classList.add('assessment-section-trigger');
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');

    const statusBadge =
      document.createElement('span');

    statusBadge.className = 'assessment-section-status';

    head.appendChild(statusBadge);

    const toggle =
      document.createElement('span');

    toggle.className = 'assessment-section-toggle';

    head.appendChild(toggle);

    const controls =
      body.querySelectorAll(
        'textarea, select, input:not([type="button"]):not([type="submit"]):not([type="file"]):not([type="hidden"])'
      );

    const hasValue = control => {
      if (
        control.type === 'checkbox' ||
        control.type === 'radio'
      ) {
        return control.checked;
      }

      return String(
        control.value || ''
      ).trim() !== '';
    };

    const updateStatus = () => {
      const hasData =
        Array.from(controls).some(hasValue);

      if (hasData) {
        statusBadge.textContent =
          '✓ есть данные';
        statusBadge.classList.add('is-complete');
        statusBadge.classList.remove('is-empty');
        section.dataset.hasData = '1';
      } else {
        statusBadge.textContent =
          'пусто';
        statusBadge.classList.add('is-empty');
        statusBadge.classList.remove('is-complete');
        section.dataset.hasData = '0';
      }

      updateCompletion();
    };

    controls.forEach(control => {
      control.addEventListener(
        'input',
        updateStatus
      );

      control.addEventListener(
        'change',
        updateStatus
      );
    });

    const setOpen = open => {
      body.hidden = !open;

      section.dataset.open =
        open ? '1' : '0';

      toggle.textContent =
        open ? 'Свернуть' : 'Открыть';

      head.setAttribute(
        'aria-expanded',
        String(open)
      );
    };

    updateStatus();

    setOpen(index === 0);

    head.onclick = () => {
      const currentlyOpen =
        section.dataset.open === '1';

      setOpen(!currentlyOpen);
    };

    head.onkeydown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      head.click();
    };
  });
}

function enableAssessmentFloatingSave(form, btn, status) {
  if (!form || !btn) return;

  if (form.dataset.floatingSaveReady === '1') {
    return;
  }

  form.dataset.floatingSaveReady = '1';

  const actions =
    btn.closest('.actions') ||
    btn.parentElement;

  if (!actions) return;

  actions.classList.add('assessment-save-bar');
  btn.classList.add('assessment-save-button');

  if (status) {
    actions.appendChild(status);

    status.classList.add('assessment-save-status');
  }

  form.classList.add('assessment-form');
}

async function loadProfile() {
  const revision = authViewRevision;
  if (!user) {
    state.profile = null;
    return;
  }

  const { data, error } = await sb
    .from('profiles')
    .select(`
  id,
  full_name,
  profession,
  organization,
  phone,
  logo_path,
  updated_at
`)
    .eq('id', user.id)
    .maybeSingle();

  if (revision !== authViewRevision) return;
  if (error) {
    console.error(
      'Ошибка загрузки профиля:',
      error
    );

    state.profile = null;
    return;
  }

  state.profile = data || null;
}

async function getSpecialistLogoUrl(logoPath) {
  if (!logoPath) {
    return '';
  }

  const { data, error } = await sb.storage
    .from('specialist-logos')
    .createSignedUrl(
      logoPath,
      3600
    );

  if (error || !data?.signedUrl) {
    console.error(
      'Ошибка получения логотипа:',
      error
    );

    return '';
  }

  return safeStorageUrl(data.signedUrl);
}

function isSpecialistProfileComplete(profile) {
  return Boolean(
    profile?.full_name?.trim() &&
    profile?.profession?.trim()
  );
}

let authViewRevision = 0;

async function renderAuthView(revision) {
  const stale = () =>
    revision !== authViewRevision || passwordRecoveryActive;

  if (revision !== authViewRevision) return;

  renderHeader();

  if (passwordRecoveryActive) {
    // Не пересоздаём форму при повторных событиях авторизации.
    if (!document.getElementById('updatePasswordForm')) {
      renderUpdatePassword();
    }

    return;
  }

  if (!user) {
    state.profile = null;
    renderLogin();
    return;
  }

  try {
    await loadCurrentRoles();
  } catch (_) {
    if (stale()) return;
    headerActions.replaceChildren();
    app.innerHTML = '<div class="card"><h1>Не удалось проверить доступ</h1><p>Обновите страницу и попробуйте ещё раз.</p><button class="btn" id="roleLogout">Выйти</button></div>';
    document.getElementById('roleLogout').onclick = () => sb.auth.signOut();
    return;
  }
  if (stale()) return;
  if (!roleGate.canNavigate()) {
    headerActions.replaceChildren();
    app.innerHTML = '<div class="card"><h1>Доступ не предоставлен</h1><p>Для нового аккаунта специалиста требуется предоставление доступа. Обратитесь в поддержку Fizira.</p><button class="btn" id="roleLogout">Выйти</button></div>';
    document.getElementById('roleLogout').onclick = () => sb.auth.signOut();
    return;
  }
  renderHeader();
  if (currentRoles.has('parent')) {
    const link = document.createElement('a');
    link.href = 'parent.html';
    link.textContent = 'Кабинет родителя';
    link.className = 'link';
    headerActions.appendChild(link);
  }
  await ensureUserConsentRecord();
  if (stale()) return;

  await loadProfile();
  if (stale()) return;

  if (!isSpecialistProfileComplete(state.profile)) {
    renderProfile();
    return;
  }

  await loadPatients();
  if (stale()) return;

  await renderPatients();
}

function scheduleAuthView(retireCurrentView = true) {
  roleGate.reset();
  currentRoles = new Set();
  const revision = ++authViewRevision;
  // Retire the previous account's DOM and property handlers before role lookup.
  if (retireCurrentView) {
    for (const overlay of document.querySelectorAll('.media-preview-overlay, .profile-delete-overlay')) {
      overlay.querySelector('[data-action="cancel"]')?.click();
      overlay.querySelectorAll('img').forEach(image => { image.onerror = null; image.removeAttribute('src'); });
      overlay.remove();
    }
    for (const node of app.querySelectorAll('*')) {
      node.onclick = null;
      node.onsubmit = null;
      node.oninput = null;
      node.onchange = null;
    }
    app.replaceChildren();
    headerActions.replaceChildren();
  }

  // Запросы выполняются после завершения обработчика Supabase.
  setTimeout(() => {
    renderAuthView(revision).catch(error => {
      console.error(
        'Ошибка обновления экрана авторизации:',
        error
      );

      if (revision === authViewRevision) {
        flash(
          'error',
          'Не удалось загрузить экран. Обновите страницу.'
        );
      }
    });
  }, 0);
}

async function init() {
  let receivedAuthEvent = false;

  sb.auth.onAuthStateChange((event, nextSession) => {
    receivedAuthEvent = true;

    const previousUserId = user?.id || null;
    const nextUserId = nextSession?.user?.id || null;
    const userChanged = Boolean(user?.id && nextUserId && user.id !== nextUserId);

    session = nextSession;
    user = nextSession?.user || null;

    if (event === 'PASSWORD_RECOVERY') {
      setPasswordRecovery(true);
    }

    if (event === 'SIGNED_OUT') {
      setPasswordRecovery(false);
      state = createEmptyState();
    } else if (userChanged) {
      state = createEmptyState();
    }

    // TOKEN_REFRESHED and a repeated SIGNED_IN on tab focus must not recreate
    // the current screen because that discards unsaved form fields.
    if (shouldRenderAuthEvent(event, previousUserId, nextUserId)) {
      scheduleAuthView(event !== 'PASSWORD_RECOVERY' || previousUserId !== nextUserId);
    }
  });

  const { data, error } = await sb.auth.getSession();

  if (error) throw error;

  if (!receivedAuthEvent) {
    session = data.session;
    user = session?.user || null;

    scheduleAuthView();
  }
}

function authIdentity() {
  return `
    <div class="auth-identity">
      <img src="fizira-symbol.png" alt="" width="34" height="34">
      <div>
        <div class="auth-wordmark">Fizira</div>
        <div class="auth-caption">Рабочее пространство специалиста</div>
      </div>
    </div>
  `;
}

function renderLogin() {
  app.innerHTML = `
    <div class="auth-wrap auth-screen">
      <section class="card auth-card">
        ${authIdentity()}
        <header class="auth-heading">
          <h1>Вход специалиста</h1>
          <p>Введите данные учётной записи Fizira.</p>
        </header>

        <div id="flash"></div>

        <form id="loginForm" class="auth-form">
          <label>Email
            <input
              type="email"
              name="email"
              required
              autocomplete="email"
            >
          </label>

          <label>Пароль Fizira
            <input
              type="password"
              name="password"
              required
              autocomplete="current-password"
            >
          </label>
          <div class="auth-inline-action">
            <button type="button" id="forgotPasswordBtn" class="link">Забыли пароль?</button>
          </div>
          <div class="auth-actions">
            <button
              class="btn primary full"
              type="submit"
            >
              Войти
            </button>

            <button
              class="btn full"
              type="button"
              id="showRegisterBtn"
            >
              Создать аккаунт
            </button>
          </div>
        </form>
      </section>
    </div>
  `;

  document
    .getElementById('loginForm')
    .onsubmit = async e => {
      e.preventDefault();

      const btn = e.submitter;

      setButtonSaving(
        btn,
        'Вхожу...'
      );

      const fd =
        new FormData(e.target);

      const { error } =
        await sb.auth.signInWithPassword({
          email:
            fd.get('email').trim(),
          password:
            fd.get('password')
        });

      if (error) {
        setButtonError(
          btn,
          'Войти'
        );

        flash(
          'error',
          'Не удалось войти. Проверьте email и пароль и повторите попытку.'
        );
      }
    };

  document
    .getElementById('showRegisterBtn')
    .onclick = () => {
      renderRegister();
    };

    document
  .getElementById('forgotPasswordBtn')
  .onclick = () => {
    renderForgotPassword();
  };
}

function renderForgotPassword() {
  app.innerHTML = `
    <div class="auth-wrap auth-screen">
      <section class="card auth-card">
        ${authIdentity()}
        <header class="auth-heading">
          <h1>Восстановление пароля</h1>
          <p>Укажите email, который использовали при регистрации.</p>
        </header>

        <div id="flash"></div>

        <form id="forgotPasswordForm" class="auth-form">
          <label>Email
            <input
              type="email"
              name="email"
              required
              autocomplete="email"
            >
          </label>

          <div class="auth-actions">
            <button
              type="submit"
              class="btn primary full"
              id="resetPasswordBtn"
            >
              Восстановить пароль
            </button>

            <button
              type="button"
              class="btn full"
              id="backFromResetBtn"
            >
              Вернуться ко входу
            </button>
          </div>
        </form>
      </section>
    </div>
  `;

  const forgotPasswordForm =
  document.getElementById('forgotPasswordForm');

forgotPasswordForm.onsubmit = async e => {
  e.preventDefault();

  const btn = e.submitter;
  const fd = new FormData(forgotPasswordForm);

  const email =
    String(fd.get('email') || '')
      .trim()
      .toLowerCase();

  setButtonSaving(
    btn,
    'Отправляю...'
  );

  const { error } =
    await sb.auth.resetPasswordForEmail(
      email,
      {
        redirectTo:
          window.location.origin +
          window.location.pathname
      }
    );

  if (error) {
    setButtonError(
      btn,
      'Восстановить пароль'
    );

    flash(
      'error',
      'Не удалось отправить письмо. Проверьте адрес и повторите попытку.'
    );

    return;
  }

  setButtonSaved(
    btn,
    '✓ Письмо отправлено'
  );

  flash(
    'success',
    'Если аккаунт с таким email существует, ссылка для восстановления пароля отправлена на почту.'
  );
};

  document
    .getElementById('backFromResetBtn')
    .onclick = () => {
      renderLogin();
    };
}

function renderUpdatePassword() {
  app.innerHTML = `
    <div class="auth-wrap auth-screen" id="passwordRecoveryScreen">
      <section class="card auth-card recovery-card" id="passwordRecoveryCard">
        ${authIdentity()}
        <header class="auth-heading">
          <h1>Создайте новый пароль</h1>
          <p>Придумайте новый пароль длиной не менее 8 символов.</p>
        </header>

        <div id="flash"></div>

        <form id="updatePasswordForm" class="auth-form recovery-form">
          <label for="newPassword">Новый пароль
            <input
              id="newPassword"
              type="password"
              name="password"
              required
              minlength="8"
              autocomplete="new-password"
            >
          </label>

          <label for="newPasswordConfirm">Повторите пароль
            <input
              id="newPasswordConfirm"
              type="password"
              name="password_confirm"
              required
              minlength="8"
              autocomplete="new-password"
            >
          </label>

          <div class="auth-actions recovery-actions">
            <button
              type="submit"
              class="btn primary full"
              id="updatePasswordBtn"
            >
              Сохранить новый пароль
            </button>
          </div>
        </form>
      </section>
    </div>
  `;

  const updatePasswordForm =
    document.getElementById('updatePasswordForm');

  updatePasswordForm.onsubmit = async e => {
    e.preventDefault();

    const btn = e.submitter;
    const fd = new FormData(updatePasswordForm);

    const password =
      String(fd.get('password') || '');

    const passwordConfirm =
      String(fd.get('password_confirm') || '');

    if (password !== passwordConfirm) {
      flash('error', 'Пароли не совпадают.');
      return;
    }

    setButtonSaving(btn, 'Сохраняю...');

    let error;

    try {
      ({ error } = await sb.auth.updateUser({ password }));
    } catch (requestError) {
      error = requestError;
    }

    if (error) {
      setButtonError(btn, 'Сохранить новый пароль');

      flash(
        'error',
        'Не удалось изменить пароль. Попробуйте ещё раз.'
      );

      return;
    }

    const recoveryCard =
      document.getElementById('passwordRecoveryCard');

    recoveryCard.innerHTML = `
      <div id="updatePasswordForm" class="recovery-success" role="status" aria-live="polite">
        <div class="recovery-success-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4.2 4.2L19 6.8" /></svg></div>
        ${authIdentity()}

        <h1>Пароль изменён</h1>

        <p class="auth-success-description">
          Новый пароль успешно сохранён. Теперь вы можете продолжить работу в приложении.
        </p>

        <button
          type="button"
          class="btn primary full"
          id="continueAfterPassword"
        >
          Перейти в Fizira
        </button>
      </div>
    `;

    document.getElementById('continueAfterPassword').onclick = () => {
      setPasswordRecovery(false);
      scheduleAuthView();
    };
  };
}
const LEGAL_DOCUMENTS = Object.freeze({
  terms: Object.freeze({
    type: 'terms',
    version: '1.0',
    hash: 'fdbab5aa8ba0fe7a9d453659a7723231ab0193ce93cf43128c974f75e5bf9f26'
  }),
  privacy: Object.freeze({
    type: 'privacy',
    version: '1.0',
    hash: '422ebcc1a8af520320cf5cd415dc3426ce471ba75d0a4bdb6395adb0d1ac86dd'
  }),
  personalDataConsent: Object.freeze({
    type: 'personal_data_consent',
    version: '1.0',
    hash: '7bb19b50f9e9c190b8a46b87624fa9e300e794b0dbde2fbe73fe2ec9ecf8cd41'
  })
});

const LEGAL_ACCEPTANCE_SOURCE = 'web-registration-v1';

async function ensureUserConsentRecord() {
  if (!user) {
    return;
  }

  const metadataDocuments = Array.isArray(user.user_metadata?.legal_documents)
    ? user.user_metadata.legal_documents
    : [];

  const legacyDocuments = [];
  if (user.user_metadata?.terms_version) {
    legacyDocuments.push({
      type: 'terms',
      version: user.user_metadata.terms_version
    });
  }
  if (user.user_metadata?.privacy_version) {
    legacyDocuments.push({
      type: 'privacy',
      version: user.user_metadata.privacy_version
    });
  }

  const documents = metadataDocuments.length
    ? metadataDocuments
    : legacyDocuments;

  if (!documents.length) {
    return;
  }

  const normalizedDocuments = documents
    .filter(document => document?.type && document?.version)
    .map(document => ({
      document_type: String(document.type),
      document_version: String(document.version),
      document_hash: document.hash ? String(document.hash) : null
    }));

  if (!normalizedDocuments.length) return;

  const { error } = await sb.rpc('record_legal_acceptances', {
    p_documents: normalizedDocuments,
    p_source: user.user_metadata?.legal_acceptance_source || 'legacy-auth-metadata'
  });

  if (error) {
    console.error(
      'Ошибка сохранения согласия:',
      error
    );
  }
}

function renderRegister() {
  app.innerHTML = `
    <div class="auth-wrap auth-screen">
      <section class="card auth-card">
        ${authIdentity()}
        <header class="auth-heading">
          <h1>Создать аккаунт</h1>
          <p>Регистрация специалиста Fizira занимает меньше минуты.</p>
        </header>

        <div id="flash"></div>

        <form id="registerForm" class="auth-form">
          <label>Email
            <input
              type="email"
              name="email"
              required
              autocomplete="email"
            >
          </label>

          <label>Пароль
            <input
              type="password"
              name="password"
              required
              minlength="8"
              autocomplete="new-password"
            >
          </label>

          <label>Повторите пароль
            <input
              type="password"
              name="password_confirm"
              required
              minlength="8"
              autocomplete="new-password"
            >
          </label>

          <label class="auth-consent">
            <input type="checkbox" name="terms_accepted" required>
            <span>Я принимаю <a href="https://fizira.com/terms" target="_blank" rel="noopener noreferrer">Пользовательское соглашение Fizira</a></span>
          </label>

          <label class="auth-consent">
            <input type="checkbox" name="personal_data_consent" required>
            <span>Я даю <a href="https://fizira.com/consent" target="_blank" rel="noopener noreferrer">согласие на обработку моих персональных данных</a> и подтверждаю ознакомление с <a href="https://fizira.com/privacy" target="_blank" rel="noopener noreferrer">Политикой обработки персональных данных</a></span>
          </label>

          <div class="auth-actions">
            <button
              class="btn primary full"
              type="submit"
              id="registerBtn"
            >
              Создать аккаунт
            </button>

            <button
              class="btn full"
              type="button"
              id="backToLoginBtn"
            >
              Уже есть аккаунт
            </button>
          </div>
        </form>
      </section>
    </div>
  `;

const registerForm =
  document.getElementById('registerForm');

registerForm.onsubmit = async e => {
  e.preventDefault();

  const btn = e.submitter;
  const fd = new FormData(registerForm);

  const email =
    String(fd.get('email') || '')
      .trim()
      .toLowerCase();

  const password =
    String(fd.get('password') || '');

  const passwordConfirm =
    String(fd.get('password_confirm') || '');

  const termsAccepted = fd.get('terms_accepted') === 'on';
  const personalDataConsent = fd.get('personal_data_consent') === 'on';

  if (password !== passwordConfirm) {
    flash(
      'error',
      'Пароли не совпадают.'
    );
    return;
  }

  if (!termsAccepted || !personalDataConsent) {
    flash(
      'error',
      'Для регистрации необходимо отдельно принять соглашение и дать согласие на обработку персональных данных.'
    );
    return;
  }

  setButtonSaving(
    btn,
    'Создаю аккаунт...'
  );

  const { data, error } =
    await sb.auth.signUp({
      email,
      password,
      options: {
        data: {
          terms_version: LEGAL_DOCUMENTS.terms.version,
          privacy_version: LEGAL_DOCUMENTS.privacy.version,
          personal_data_consent_version: LEGAL_DOCUMENTS.personalDataConsent.version,
          legal_documents: Object.values(LEGAL_DOCUMENTS),
          legal_acceptance_source: LEGAL_ACCEPTANCE_SOURCE
        },

        emailRedirectTo:
          window.location.origin +
          window.location.pathname
      }
    });

  if (error) {
    setButtonError(
      btn,
      'Создать аккаунт'
    );

    flash(
      'error',
      'Не удалось создать аккаунт. Проверьте данные и повторите попытку.'
    );

    return;
  }

  if (data.session) {
    setButtonSaved(
      btn,
      '✓ Аккаунт создан'
    );

    flash(
      'success',
      'Аккаунт создан. Сейчас откроется профиль специалиста.'
    );

    return;
  }

  setButtonSaved(
    btn,
    '✓ Проверьте почту'
  );

  flash(
    'success',
    'Мы отправили письмо для подтверждения email. Перейдите по ссылке из письма, затем войдите в Fizira.'
  );
};

  document
    .getElementById('backToLoginBtn')
    .onclick = () => {
      renderLogin();
    };
}

function renderProfile() {
  const accountRevision = authViewRevision, accountUserId = user?.id;
  const accountIsCurrent = () => accountRevision === authViewRevision && accountUserId === user?.id && roleGate.canNavigate();
  if (app.querySelector('.parent-report-workspace')?.parentReportController) return leaveParentReportWorkspace(app).then(ok => { if (ok && accountIsCurrent()) renderProfile(); });

  if (!roleGate.canNavigate() || passwordRecoveryActive) return;
  const profile = state.profile || {};

  app.innerHTML = `
    <div class="card profile-page">
      <header class="profile-intro">
        <div>
          <div class="workspace-eyebrow">Fizira</div>
          <h1>Профиль специалиста</h1>
          <p>Данные используются в документах, отчётах и рабочем пространстве Fizira.</p>
        </div>
      </header>

      <form id="profileForm">
        <section class="profile-section">
          <div class="profile-section-heading">
            <h2>Основные данные</h2>
            <p>Будут отображаться в отчётах для родителей и других документах.</p>
          </div>
          <div class="profile-field-grid">
            <label>ФИО
              <input
                name="full_name"
                required
                value="${esc(profile.full_name || '')}"
                placeholder="Например: Алексей Антонов"
              >
            </label>

            <label>Профессия / специализация
              <input
                name="profession"
                required
                value="${esc(profile.profession || '')}"
                placeholder="Например: Физический терапевт"
              >
            </label>

            <label>Организация / место работы
              <input
                name="organization"
                value="${esc(profile.organization || '')}"
                placeholder="Например: Центр детской реабилитации"
              >
            </label>

            <label>Телефон
              <input
                name="phone"
                type="tel"
                value="${esc(profile.phone || '')}"
                placeholder="+7..."
              >
            </label>
          </div>
        </section>

        <section class="profile-section profile-account-section">
          <div class="profile-section-heading">
            <h2>Учётная запись</h2>
            <p>Адрес привязан к входу в Fizira и здесь не редактируется.</p>
          </div>
          <label>Email
            <input
              value="${esc(user?.email || '')}"
              readonly
            >
          </label>
        </section>

        <section class="profile-section profile-brand-section">
          <div class="profile-section-heading">
            <h2>Логотип</h2>
            <p>Необязателен. Он появится в документах от вашего имени.</p>
          </div>
          <label class="profile-logo-picker">
            <span>Выбрать файл</span>
            <input
              id="profileLogoFile"
              type="file"
              accept="image/png,image/jpeg,image/webp"
            >
          </label>
          <p class="help profile-logo-help">PNG, JPEG или WebP, до 5 МБ.</p>
          <div id="profileLogoPreview" class="profile-logo-preview"></div>
        </section>

        <div class="profile-actions">
          <button
            type="submit"
            class="btn primary full"
            id="profileSaveBtn"
          >
            Сохранить профиль
          </button>

          <button
            type="button"
            class="btn profile-back-button"
            id="profileBackBtn"
          >
            К пациентам
          </button>
        </div>

        <section class="profile-danger-zone">
          <div>
            <h2>Удаление аккаунта</h2>
            <p>Аккаунт, пациенты, занятия, оценки, документы, фотографии и другие связанные данные будут удалены безвозвратно.</p>
          </div>
          <button
            type="button"
            class="btn danger profile-delete-button"
            id="deleteAccountBtn"
          >
            Удалить аккаунт
          </button>
        </section>

        <div id="profileStatus" class="save-status profile-save-status" aria-live="polite"></div>
      </form>
    </div>
  `;

const profileLogoPreview =
  document.getElementById('profileLogoPreview');

async function showSavedProfileLogo() {
    if (!accountIsCurrent()) return;
  if (
    !profileLogoPreview ||
    !state.profile?.logo_path
  ) {
    return;
  }

  const { data, error } = await sb.storage
    .from('specialist-logos')
    .createSignedUrl(
      state.profile.logo_path,
      3600
    );
    if (!accountIsCurrent()) return;

  if (error || !data?.signedUrl) {
    console.error(
      'Ошибка загрузки логотипа:',
      error
    );
    return;
  }

  const safeLogoUrl = safeStorageUrl(data.signedUrl);

  if (!safeLogoUrl) {
    console.error('Получен недопустимый URL логотипа');
    return;
  }

  profileLogoPreview.innerHTML = `
    <img
      src="${esc(safeLogoUrl)}"
      alt="Логотип специалиста"
      class="profile-logo-image"
    >
  `;
}

showSavedProfileLogo();

  const profileForm =
  document.getElementById('profileForm');

  const setProfileStatus = (message = '', stateName = '') => {
    if (!accountIsCurrent()) return;
    const profileStatus = document.getElementById('profileStatus');
    if (!profileStatus) return;
    profileStatus.textContent = message;
    profileStatus.dataset.state = stateName;
  };

  const markProfileDirty = () => {
  if (!accountIsCurrent()) return;
  const profileSaveBtn =
    document.getElementById('profileSaveBtn');

  if (profileSaveBtn) {
    profileSaveBtn.disabled = false;
    profileSaveBtn.textContent =
      'Сохранить изменения';
  }

  setProfileStatus('Есть несохранённые изменения', 'dirty');
};

profileForm
  ?.querySelectorAll(
    'input[name="full_name"], ' +
    'input[name="profession"], ' +
    'input[name="organization"], ' +
    'input[name="phone"]'
  )
  .forEach(input => {
    input.addEventListener(
      'input',
      markProfileDirty
    );
  });

const profileLogoFile =
  document.getElementById('profileLogoFile');

if (profileLogoFile) {
  profileLogoFile.addEventListener(
    'change',
    markProfileDirty
  );
}

if (profileForm) {
  profileForm.onsubmit = async e => {
    if (!accountIsCurrent()) return;
    e.preventDefault();

    const profileSaveBtn =
      document.getElementById('profileSaveBtn');

    const fd = new FormData(profileForm);

    const logoFile =
  document.getElementById('profileLogoFile')
    ?.files?.[0] || null;

let logoPath =
  state.profile?.logo_path || null;

if (logoFile) {
  const allowedTypes = [
    'image/png',
    'image/jpeg',
    'image/webp'
  ];

  if (!allowedTypes.includes(logoFile.type)) {
    profileSaveBtn.disabled = false;
    profileSaveBtn.textContent =
      'Сохранить профиль';

    setProfileStatus('Выберите PNG, JPEG или WebP.', 'error');

    return;
  }

  if (logoFile.size > 5 * 1024 * 1024) {
    profileSaveBtn.disabled = false;
    profileSaveBtn.textContent =
      'Сохранить профиль';

    setProfileStatus('Логотип должен быть не больше 5 МБ.', 'error');

    return;
  }

  const storagePath =
    `${accountUserId}/logo`;

  const { error: logoError } = await sb.storage
    .from('specialist-logos')
    .upload(
      storagePath,
      logoFile,
      {
        upsert: true,
        contentType: logoFile.type,
        cacheControl: '3600'
      }
    );
    if (!accountIsCurrent()) return;

  if (logoError) {
    console.error(
      'Ошибка загрузки логотипа:',
      logoError
    );

    profileSaveBtn.disabled = false;
    profileSaveBtn.textContent =
      'Сохранить профиль';

    setProfileStatus('Не удалось загрузить логотип. Повторите попытку.', 'error');

    return;
  }

  logoPath = storagePath;
}

    const profilePayload = {
      id: accountUserId,
      full_name:
        String(fd.get('full_name') || '').trim(),
      profession:
        String(fd.get('profession') || '').trim(),
      organization:
        String(fd.get('organization') || '').trim() || null,
      phone:
        String(fd.get('phone') || '').trim() || null,
        logo_path: logoPath,
      updated_at: new Date().toISOString()
    };

    profileSaveBtn.disabled = true;
    profileSaveBtn.textContent = 'Сохраняю...';

    setProfileStatus('Сохраняем изменения…', 'saving');

    const { data, error } = await sb
      .from('profiles')
      .upsert(
        profilePayload,
        {
          onConflict: 'id'
        }
      )
      .select(`
        id,
        full_name,
        profession,
        organization,
        phone,
        logo_path,
        updated_at
      `)
      .single();
    if (!accountIsCurrent()) return;

    if (error) {
      console.error(
        'Ошибка сохранения профиля:',
        error
      );

      profileSaveBtn.disabled = false;
      profileSaveBtn.textContent =
        'Сохранить профиль';

      setProfileStatus('Не удалось сохранить профиль. Проверьте подключение и повторите.', 'error');

      return;
    }

    state.profile = data;

    profileSaveBtn.disabled = true;
profileSaveBtn.textContent =
  '✓ Профиль сохранён';

    setProfileStatus('Данные сохранены в облаке', 'saved');

    
  };
}

const profileBackBtn =
  document.getElementById('profileBackBtn');

if (profileBackBtn) {
  profileBackBtn.onclick = async () => {
    if (!accountIsCurrent()) return;
    if (!isSpecialistProfileComplete(state.profile)) {
      setProfileStatus('Сначала заполните ФИО и профессию и сохраните профиль.', 'error');

      return;
    }

    await loadPatients();
    if (!accountIsCurrent()) return;
    await renderPatients();
    if (!accountIsCurrent()) return;
  };
}

const deleteAccountBtn =
  document.getElementById('deleteAccountBtn');

function requestAccountDeletionPassword() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'profile-delete-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'deletePasswordTitle');
    overlay.innerHTML = `
      <form class="card profile-delete-dialog">
        <header>
          <div class="workspace-eyebrow">Опасное действие</div>
          <h2 id="deletePasswordTitle">Подтвердите удаление аккаунта</h2>
        </header>
        <p>
          Введите текущий пароль. Он будет проверен сервером Fizira и не
          сохраняется в приложении.
        </p>
        <label for="deleteAccountPassword">Текущий пароль</label>
        <input
          id="deleteAccountPassword"
          name="password"
          type="password"
          autocomplete="current-password"
          required
        >
        <div class="profile-delete-actions">
          <button type="button" class="btn" data-action="cancel">
            Отмена
          </button>
          <button type="submit" class="btn danger">
            Удалить аккаунт
          </button>
        </div>
      </form>
    `;

    const finish = value => {
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector('[data-action="cancel"]').onclick = () => finish(null);
    overlay.onclick = event => {
      if (event.target === overlay) finish(null);
    };
    overlay.querySelector('form').onsubmit = event => {
      event.preventDefault();
      const password = overlay.querySelector('[name="password"]').value;
      finish(password || null);
    };
    document.body.appendChild(overlay);
    overlay.querySelector('[name="password"]').focus();
  });
}

if (deleteAccountBtn) {
  deleteAccountBtn.onclick = async () => {
    if (!accountIsCurrent()) return;
    const firstConfirmed = window.confirm(
      'Удалить аккаунт Fizira?\n\n' +
      'Будут безвозвратно удалены все пациенты, занятия, оценки, ' +
      'документы, фотографии и другие связанные данные.'
    );

    if (!firstConfirmed) {
      return;
    }

    const password = await requestAccountDeletionPassword();
    if (!accountIsCurrent()) return;
    if (!password) return;

    const confirmation = window.prompt(
      'Это действие нельзя отменить.\n\n' +
      'Для подтверждения напишите: УДАЛИТЬ'
    );

    if (confirmation !== 'УДАЛИТЬ') {
      if (confirmation !== null) {
        window.alert(
          'Удаление отменено: контрольное слово введено неверно.'
        );
      }

      return;
    }

    deleteAccountBtn.disabled = true;
    deleteAccountBtn.textContent =
      'Удаляю аккаунт...';

    setProfileStatus('Удаляем аккаунт и связанные данные…', 'saving');

    const { data, error } =
      await sb.functions.invoke(
        'delete-account',
        {
          body: { password }
        }
      );
    if (!accountIsCurrent()) return;

    if (error || !data?.success) {
      console.error(
        'Ошибка удаления аккаунта:',
        error,
        data
      );

      deleteAccountBtn.disabled = false;
      deleteAccountBtn.textContent =
        'Удалить аккаунт';

      setProfileStatus('Не удалось удалить аккаунт. Повторите попытку или обратитесь в поддержку.', 'error');

      return;
    }

    try {
      await sb.auth.signOut({
        scope: 'local'
      });
    if (!accountIsCurrent()) return;
    } catch (signOutError) {
    if (!accountIsCurrent()) return;
      console.warn(
        'Локальный выход после удаления:',
        signOutError
      );
    }

    window.location.reload();
  };
}

}

async function loadPatients() {
  if (!roleGate.canNavigate()) return;
  const revision = authViewRevision;
  const { data, error } = await sb
    .from("patients")
    .select(
  "id,therapist_id,display_name,date_of_birth,sex,primary_complaint,status,created_at,ai_analysis,ai_analysis_updated_at,ai_dynamics_analysis,ai_dynamics_updated_at,next_session_plan,schedule_price_kopecks"
)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  if (revision !== authViewRevision || !roleGate.canNavigate()) return;
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

async function activityForPatients() {
  const ids = state.patients.map(p => p.id);

  if (!ids.length) return {};

  const [sessionsResult, assessmentsResult] = await Promise.all([
    sb
      .from('sessions')
      .select('patient_id, created_at')
      .in('patient_id', ids),

    sb
      .from('assessments')
      .select('patient_id, created_at')
      .in('patient_id', ids)
  ]);

  if (sessionsResult.error) {
    throw new Error(sessionsResult.error.message);
  }

  if (assessmentsResult.error) {
    throw new Error(assessmentsResult.error.message);
  }

  const activity = {};

  ids.forEach(id => {
    activity[id] = null;
  });

  [...(sessionsResult.data || []), ...(assessmentsResult.data || [])]
    .forEach(item => {
      if (!item.created_at) return;

      const current = activity[item.patient_id];

      if (
        !current ||
        new Date(item.created_at) > new Date(current)
      ) {
        activity[item.patient_id] = item.created_at;
      }
    });

  return activity;
}

async function loadAiAnalysisHistory(patientId) {
  const { data, error } = await sb
    .from("ai_analysis_history")
    .select("id, analysis, patient_snapshot, created_at")
    .eq("patient_id", patientId)
    .eq("analysis_type", "general")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

async function loadAiDynamicsHistory(patientId) {
  const { data, error } = await sb
    .from("ai_analysis_history")
    .select("id, analysis, patient_snapshot, created_at")
    .eq("patient_id", patientId)
    .eq("analysis_type", "dynamics")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

async function renderPatients() {
  if (!roleGate.canNavigate() || passwordRecoveryActive) return;
  const revision = authViewRevision;
  if (app.querySelector('.parent-report-workspace')?.parentReportController && (!await leaveParentReportWorkspace(app) || revision !== authViewRevision || !roleGate.canNavigate())) return;
  const counts = await countsForPatients();
  if (revision !== authViewRevision || !roleGate.canNavigate()) return;
  const activity = await activityForPatients();
  if (revision !== authViewRevision || !roleGate.canNavigate() || passwordRecoveryActive) return;

const sortedPatients = [...state.patients].sort((a, b) => {
  const dateA = activity[a.id]
    ? new Date(activity[a.id]).getTime()
    : 0;

  const dateB = activity[b.id]
    ? new Date(activity[b.id]).getTime()
    : 0;

  if (dateA !== dateB) {
    return dateB - dateA;
  }

  return String(a.display_name || '').localeCompare(
    String(b.display_name || ''),
    'ru'
  );
});

const recentPatients = sortedPatients.slice(0, 3);

const alphabeticPatients = [...state.patients].sort((a, b) =>
  String(a.display_name || '').localeCompare(
    String(b.display_name || ''),
    'ru'
  )
);

const patientLetters = [
  ...new Set(
    alphabeticPatients
      .map(p =>
        String(p.display_name || '')
          .trim()
          .charAt(0)
          .toLocaleUpperCase('ru-RU')
      )
      .filter(Boolean)
  )
];

const patientCardHtml = p => `
  <button
    type="button"
    class="patient-card"
    data-pid="${p.id}"
    data-patient-name="${esc(String(p.display_name || ''))}"
  >
    <div class="patient-card-content">
      <div class="patient-card-main">
        <div class="name">
          ${esc(p.display_name)}
        </div>

        <div class="muted tiny">
          ${esc(ageFromDob(p.date_of_birth))}
          ·
          ${esc(sexLabel(p.sex))}
        </div>

        ${
          p.primary_complaint
            ? `
              <div class="item-sub patient-complaint">
                ${esc(p.primary_complaint)}
              </div>
            `
            : ''
        }
      </div>

      <div class="patient-counts" aria-label="Статистика пациента">
        ${counts[p.id]?.goals || 0} целей
        <br>
        ${counts[p.id]?.sessions || 0} занятий
      </div>
    </div>
  </button>
`;

  app.innerHTML = `
  <div class="topline patients-page-heading">
    <div>
      <h2 style="margin-bottom:2px">Пациенты</h2>
      <div class="muted tiny">
        Облачная база · ${state.patients.length} пациентов
      </div>
    </div>

    <button
      class="btn primary small"
      id="addPatient"
      type="button"
    >
      + Ребёнок
    </button>
  </div>

  <div id="flash"></div>

  <div class="patient-search">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
    <input
      id="patientSearch"
      type="search"
      placeholder="Найти пациента по имени"
      autocomplete="off"
    >
  </div>

  ${
  state.patients.length
    ? `
      <div id="recentPatientsSection" class="patient-group">
        <div class="patient-group-title">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></svg>
          <span>Недавние</span>
        </div>

        <div class="patient-list">
          ${recentPatients.map(patientCardHtml).join('')}
        </div>
      </div>

      <div id="allPatientsSection" class="patient-group patient-group-all">
        <div class="patient-group-title">Все пациенты</div>
<div id="patientAlphabet" class="patient-alphabet">

<button
  type="button"
  class="btn small"
  id="showAllPatients"
>
  Все
</button>

  ${patientLetters
    .map(letter => `
      <button
        type="button"
        class="btn small"
        data-patient-letter="${esc(letter)}"
      >
        ${esc(letter)}
      </button>
    `)
    .join('')}
</div>
        <div class="patient-list">
          ${alphabeticPatients.map(patientCardHtml).join('')}
        </div>
      </div>
    `
    : `
      <div class="card empty">
        В облачной базе пока нет пациентов.
      </div>
    `
}
`;
document.querySelectorAll('[data-patient-letter]').forEach(letterBtn => {
  letterBtn.onclick = () => {
    const letter = String(
      letterBtn.dataset.patientLetter || ''
    ).toLocaleLowerCase('ru-RU');

    if (patientSearch) {
      patientSearch.value = '';
    }

    if (recentPatientsSection) {
      recentPatientsSection.style.display = 'none';
    }

    document
      .querySelectorAll('#allPatientsSection [data-patient-name]')
      .forEach(card => {
        const name = String(
          card.dataset.patientName || ''
        ).toLocaleLowerCase('ru-RU');

        card.style.display =
          name.startsWith(letter) ? '' : 'none';
      });
  };
});

const showAllPatientsBtn = document.getElementById('showAllPatients');

if (showAllPatientsBtn) {
  showAllPatientsBtn.onclick = () => {
    if (patientSearch) {
      patientSearch.value = '';
    }

    if (recentPatientsSection) {
      recentPatientsSection.style.display = '';
    }

    document
      .querySelectorAll('#allPatientsSection [data-patient-name]')
      .forEach(card => {
        card.style.display = '';
      });
  };
}

  document.getElementById('addPatient').onclick = () => { if (revision === authViewRevision) renderNewPatient(); };

const patientSearch = document.getElementById('patientSearch');
const recentPatientsSection = document.getElementById('recentPatientsSection');

if (patientSearch) {
  patientSearch.oninput = () => {
    const query = patientSearch.value
      .trim()
      .toLocaleLowerCase('ru-RU');

    if (recentPatientsSection) {
      recentPatientsSection.style.display = query ? 'none' : '';
    }

    document
      .querySelectorAll('#allPatientsSection [data-patient-name]')
      .forEach(card => {
        const name = String(
          card.dataset.patientName || ''
        ).toLocaleLowerCase('ru-RU');

        card.style.display =
          name.includes(query) ? '' : 'none';
      });
  };
}

  document.querySelectorAll('[data-pid]').forEach(b => b.onclick = async () => { if (revision !== authViewRevision || !roleGate.canNavigate()) return; state.patientId = b.dataset.pid; state.tab = 'overview'; await loadPatientData(); if (revision !== authViewRevision) return; renderPatient() });
}

function renderNewPatient() {
  if (!roleGate.canNavigate() || passwordRecoveryActive) return;
  const revision = authViewRevision;
  app.innerHTML = `<div class="topline"><h2 style="margin:0">Новый ребёнок</h2><button class="link" id="cancel">Отмена</button></div><div id="flash"></div><form class="card" id="patientForm"><label>Имя / псевдоним для теста</label><input name="display_name" required><div class="row"><div><label>Дата рождения</label><input type="date" name="date_of_birth"></div><div><label>Пол</label><select name="sex"><option value="unspecified">Не указано</option><option value="male">Мальчик</option><option value="female">Девочка</option></select></div></div><label>Основная причина обращения</label><textarea name="primary_complaint"></textarea><div class="actions"><button id="patientSaveBtn" class="btn primary full" type="submit">Сохранить в облако</button></div></form>`;
  document.getElementById('cancel').onclick = renderPatients;
  const form = document.getElementById('patientForm'), btn = document.getElementById('patientSaveBtn'); watchFormDirty(form, btn, 'Сохранить в облако');
  form.onsubmit = async e => { e.preventDefault(); if (revision !== authViewRevision || !roleGate.canNavigate() || !form.isConnected) return; setButtonSaving(btn); const fd = new FormData(e.target); const payload = { display_name: fd.get('display_name').trim(), date_of_birth: fd.get('date_of_birth') || null, sex: fd.get('sex'), primary_complaint: fd.get('primary_complaint').trim() || null }; const { data, error } = await sb.from('patients').insert(payload).select().single(); if (revision !== authViewRevision) return; if (error) { setButtonError(btn); return flash('error', error.message) } setButtonSaved(btn); await sleep(650); if (revision !== authViewRevision) return; await loadPatients(); if (revision !== authViewRevision) return; state.patientId = data.id; state.tab = 'overview'; await loadPatientData(); if (revision !== authViewRevision) return; renderPatient() };
}

const currentPatient = () => state.patients.find(p => p.id === state.patientId);

function renderEditPatient() {
  const accountRevision = authViewRevision, accountUserId = user?.id;
  const accountIsCurrent = () => accountRevision === authViewRevision && accountUserId === user?.id && roleGate.canNavigate();
  if (app.querySelector('.parent-report-workspace')?.parentReportController) return leaveParentReportWorkspace(app).then(ok => { if (ok && accountIsCurrent()) renderEditPatient(); });

  if (!roleGate.canNavigate() || passwordRecoveryActive) return;
  const p = currentPatient();

  if (!p) return renderPatients();

  app.innerHTML = `
    <div class="topline">
      <h2 style="margin:0">Редактирование карточки</h2>
      <button class="link" id="cancelPatientEdit" type="button">Отмена</button>
    </div>

    <div id="flash"></div>

    <form class="card" id="patientEditForm">
      <label>Имя / псевдоним для теста</label>
      <input
        name="display_name"
        value="${esc(p.display_name)}"
        required
      >

      <div class="row">
        <div>
          <label>Дата рождения</label>
          <input
            type="date"
            name="date_of_birth"
            value="${esc(p.date_of_birth || '')}"
          >
        </div>

        <div>
          <label>Пол</label>
          <select name="sex">
            <option value="unspecified" ${!p.sex || p.sex === 'unspecified' ? 'selected' : ''}>Не указано</option>
            <option value="male" ${p.sex === 'male' ? 'selected' : ''}>Мальчик</option>
            <option value="female" ${p.sex === 'female' ? 'selected' : ''}>Девочка</option>
          </select>
        </div>
      </div>

      <label>Основная причина обращения</label>
      <textarea name="primary_complaint">${esc(p.primary_complaint || '')}</textarea>

      <div class="actions">
        <button
          id="patientEditSaveBtn"
          class="btn primary full"
          type="submit"
        >
          Сохранить изменения
        </button>
      </div>
    </form>
  `;

  document.getElementById('cancelPatientEdit').onclick = renderPatient;

  const form = document.getElementById('patientEditForm');
  const btn = document.getElementById('patientEditSaveBtn');

  watchFormDirty(form, btn, 'Сохранить изменения');

  form.onsubmit = async e => {
    if (!accountIsCurrent()) return;
    e.preventDefault();

    const fd = new FormData(form);
    const displayName = String(fd.get('display_name') || '').trim();

    if (!displayName) {
      return flash('error', 'Укажите имя или псевдоним пациента.');
    }

    const payload = {
      display_name: displayName,
      date_of_birth: fd.get('date_of_birth') || null,
      sex: fd.get('sex') || 'unspecified',
      primary_complaint: String(fd.get('primary_complaint') || '').trim() || null
    };

    setButtonSaving(btn);

    const { data, error } = await sb
      .from('patients')
      .update(payload)
      .eq('id', p.id)
      .select()
      .single();
    if (!accountIsCurrent()) return;

    if (error) {
      setButtonError(btn);
      return flash('error', `Не удалось сохранить карточку: ${error.message}`);
    }

    setButtonSaved(btn);
    await sleep(500);
    if (!accountIsCurrent()) return;
    await loadPatients();
    if (!accountIsCurrent()) return;
    state.patientId = data.id;
    renderPatient();
  };
}

async function loadPatientData() {
  if (!roleGate.canNavigate()) return;
  const revision = authViewRevision;
  const pid = state.patientId;

  const [g, s, a, c, r] = await Promise.all([
    sb
      .from('goals')
      .select('*')
      .eq('patient_id', pid)
      .order('created_at', { ascending: false }),

    sb
      .from('sessions')
      .select('*')
      .eq('patient_id', pid)
      .order('session_date', { ascending: false }),

    sb
      .from('assessments')
      .select('*')
      .eq('patient_id', pid)
      .eq('assessment_type', 'initial')
      .order('created_at', { ascending: false })
      .limit(1),

    sb
      .from('patient_contacts')
      .select('*')
      .eq('patient_id', pid)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true }),

    sb
  .from('parent_reports')
  .select('id,patient_id,therapist_id,publication_status,published_at,published_snapshot,created_at,updated_at,therapist_name,therapist_profession,therapist_organization,therapist_phone,therapist_logo_path,complaint,strengths,observations,goals,progress,recommendations')
  .eq('patient_id', pid)
  .order('created_at', { ascending: false })
  ]);

 const loadError =
  g.error ||
  s.error ||
  a.error ||
  c.error ||
  r.error;

  if (loadError) {
    throw new Error(loadError.message);
  }

  if (revision !== authViewRevision || !roleGate.canNavigate() || state.patientId !== pid) return;
  state.goals = g.data || [];
  state.sessions = s.data || [];
  state.assessment = (a.data || [])[0] || null;
  state.contacts = c.data || [];
  state.parentReports = r.data || [];
}

function goalsHtml(goals, deletable = false) {
  if (!goals.length) {
    return `<div class="empty compact-empty">Целей пока нет.</div>`;
  }

  return goals.map(g => `
    <article class="goal goal-card">
      <div class="goal-top">
        <div>
          <div class="goal-label">Функциональная цель</div>
          <div class="item-title">${esc(g.title)}</div>
        </div>
        <div class="goal-pct">${g.progress}%</div>
      </div>
      <div class="progress"><span style="width:${Math.max(0, Math.min(100, g.progress))}%"></span></div>
      <div class="goal-meta">
        <span>${esc(g.criterion || 'Критерий не указан')}</span>
        <span>${g.deadline ? fmtDate(g.deadline) : 'Срок не указан'}</span>
      </div>
      <span class="badge goal-parent-badge">${g.parent_visible ? 'Родителю: опубликовано' : 'Родителю: скрыто'}</span>
      ${state.tab === 'goals' ? `
        <div class="goal-actions">
          <button type="button" class="link" data-edit-goal="${g.id}">Изменить</button>
          ${g.status !== 'achieved' ? `<button type="button" class="link goal-complete-link" data-complete-goal="${g.id}">Завершить</button>` : ''}
          <button type="button" class="link" data-visibility-goal="${g.id}">${g.parent_visible ? 'Скрыть от родителя' : 'Показать родителю'}</button>
          <button type="button" class="link goal-delete-link" data-del-goal="${g.id}">Удалить</button>
        </div>
      ` : ''}
    </article>
  `).join('');
}
function renderPatient(parentInvitationSent = false) {
  const accountRevision = authViewRevision, accountUserId = user?.id;
  const accountIsCurrent = () => accountRevision === authViewRevision && accountUserId === user?.id && roleGate.canNavigate();

  if (!roleGate.canNavigate() || passwordRecoveryActive) return;
  if (app.querySelector('.parent-report-workspace')?.parentReportController) return leaveParentReportWorkspace(app).then(ok => { if (ok && accountIsCurrent()) renderPatient(parentInvitationSent); });
  const p = currentPatient(); if (!p) return renderPatients();
  app.innerHTML = `
    ${patientFlowerHtml({patient:p, tab:state.tab, age:ageFromDob(p.date_of_birth), sex:sexLabel(p.sex), dob:p.date_of_birth ? fmtDate(p.date_of_birth) : 'Дата рождения не указана', compact:readFlowerCompact(window)})}
    <div id="flash"></div>
    <div id="tabContent"></div>`;
  document.getElementById('editPatient').onclick = renderEditPatient; document.getElementById('backPatients').onclick = renderPatients;
  const flowerRoot = app.querySelector('.patient-flower');
  const flowerIsCurrent = () => accountIsCurrent() && state.patientId === p.id && flowerRoot.isConnected;
  const firstPanel = document.getElementById('tabContent');
  firstPanel.dataset.patientSection = state.tab;
  const panels = new Map([[state.tab, firstPanel]]);
  let navigating = false;
  async function navigatePatientSection(tab) {
    if (!flowerIsCurrent() || navigating || tab === state.tab) return false;
    navigating = true;
    try {
      const activePanel = document.getElementById('tabContent');
      // Keep the report controller alive; its existing save gate still blocks failed saves.
      const reportController = activePanel.querySelector('.parent-report-workspace')?.parentReportController;
      if (reportController && !await reportController.beforeLeave()) return false;
      if (!flowerIsCurrent()) return false;
      await collapsePatientFlower(flowerRoot);
      if (!flowerIsCurrent()) return false;
      let panel = panels.get(tab);
      if (panel?.dataset.needsRefresh && panel.querySelector('.parent-report-workspace')?.parentReportController) {
        if (!await leaveParentReportWorkspace(panel) || !flowerIsCurrent()) return false;
      }
      saveFlowerCompact(window,true);
      activePanel.hidden = true;
      activePanel.removeAttribute('id');
      state.tab = tab;
      if (panel?.dataset.needsRefresh) { panel.remove(); panels.delete(tab); panel = null; }
      if (!panel) {
        panel = document.createElement('div');
        panel.dataset.patientSection = tab;
        panel.id = 'tabContent';
        activePanel.after(panel);
        panels.set(tab, panel);
        renderTab(p, false, navigatePatientSection);
      } else {
        panel.id = 'tabContent';
        panel.hidden = false;
        if (tab === 'overview') {
          panel.querySelector('.parent-report-workspace')?.parentReportController?.refreshReports(state.parentReports);
          panel.querySelector('.patient-overview')?.refreshOverview?.();
        }
        if (tab === 'parent') panel.refreshPatientFacts?.();
      }
      flowerRoot.querySelectorAll('[data-tab]').forEach(button => {
        const active = button.dataset.tab === tab;
        button.classList.toggle('is-active', active);
        if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
      });
      const selected = app.querySelector(`[data-tab="${tab}"]`);
      selected?.focus({preventScroll:true});
      selected?.scrollIntoView({block:'nearest',inline:'nearest'});
      return true;
    } finally { navigating = false; }
  }
  // A completed save refreshes its section, keeping drafts in every other section alive.
  navigatePatientSection.refresh = async (tab, invitationSent = false) => {
    if (!flowerIsCurrent()) return;
    if (['goals','sessions'].includes(tab)) {
      const progress = panels.get('progress');
      if (progress) {
        if (state.tab === 'progress' && !navigating) navigatePatientSection.refresh('progress');
        else progress.dataset.needsRefresh = 'true';
      }
      panels.get('parent')?.refreshPatientFacts?.();
    }
    const panel = panels.get(tab);
    if (!panel) return;
    if (state.tab !== tab || navigating) { panel.dataset.needsRefresh = 'true'; return; }
    navigating = true;
    try {
      if (panel.querySelector('.parent-report-workspace')?.parentReportController && !await leaveParentReportWorkspace(panel)) return;
      if (!flowerIsCurrent()) return;
      const replacement = document.createElement('div');
      replacement.id = 'tabContent'; replacement.dataset.patientSection = tab;
      panel.replaceWith(replacement); panels.set(tab, replacement);
      renderTab(p, invitationSent, navigatePatientSection);
    } finally { navigating = false; }
  };
  mountPatientFlower({root:flowerRoot, isCurrent:flowerIsCurrent, navigate:navigatePatientSection});
  renderTab(p, parentInvitationSent === true, navigatePatientSection);
  const actions = app.querySelector(".actions");
  
  const deletePatientWrap = document.createElement("div");
deletePatientWrap.style.textAlign = "center";
deletePatientWrap.style.margin = "28px 0 8px";

const deletePatientBtn = document.createElement("button");
deletePatientBtn.id = "deletePatientBtn";
deletePatientBtn.className = "btn";
deletePatientBtn.textContent = "Удалить пациента";
deletePatientBtn.style.padding = "8px 14px";
deletePatientBtn.style.fontSize = "13px";
deletePatientBtn.style.color = "#b42318";
deletePatientBtn.style.borderColor = "#f0b4ae";
deletePatientBtn.style.background = "#fff";

deletePatientWrap.append(deletePatientBtn);
app.append(deletePatientWrap);

deletePatientBtn.onclick = async () => {
    if (!accountIsCurrent()) return;
  const confirmed = confirm(
    `Удалить пациента "${p.display_name}"?\n\nБудут безвозвратно удалены карточка, оценки, цели, занятия, анализы, документы и медиа.`
  );

  if (!confirmed) return;

  const typedName = prompt(
    `Для окончательного подтверждения введите имя пациента:\n${p.display_name}`
  );

  if (typedName !== p.display_name) {
    alert("Имя не совпало. Удаление отменено.");
    return;
  }

  deletePatientBtn.disabled = true;
  deletePatientBtn.textContent = "Удаляю...";

  try {
    // Получаем пути всех фото и документов пациента
    const { data: mediaRows, error: mediaError } = await sb
      .from("patient_media")
      .select("storage_path")
      .eq("patient_id", p.id);
    if (!accountIsCurrent()) return;

    if (mediaError) throw mediaError;

    const paths = (mediaRows || [])
      .map(item => item.storage_path)
      .filter(Boolean);

    // Сначала удаляем физические файлы из Storage
    if (paths.length) {
      const { error: storageError } = await sb.storage
        .from("patient-media")
        .remove(paths);
    if (!accountIsCurrent()) return;

      if (storageError) throw storageError;
    }

    // Затем удаляем пациента.
    // Остальные таблицы очистятся автоматически через ON DELETE CASCADE.
    const { data: deletedPatients, error: patientError } = await sb
  .from("patients")
  .delete()
  .eq("id", p.id)
  .select("id");
    if (!accountIsCurrent()) return;

if (patientError) throw patientError;

if (!deletedPatients || deletedPatients.length !== 1) {
  throw new Error(
    `Пациент не удалён из базы. Удалено строк: ${deletedPatients?.length || 0}`
  );
}

    alert(`Пациент "${p.display_name}" полностью удалён.`);
    location.reload();

  } catch (error) {
    if (!accountIsCurrent()) return;
    console.error("Не удалось удалить пациента:", error);

    alert(
  `Не удалось полностью удалить пациента.\n\n${error.message || "Неизвестная ошибка"}`
);

    deletePatientBtn.disabled = false;
    deletePatientBtn.textContent = "Удалить пациента";
  }
};

  const aiBtn = document.createElement("button");
  aiBtn.id = "aiAnalyzeBtn";
  aiBtn.className = "btn primary ai-action-button";
  aiBtn.textContent = "Анализ пациента";
  app.querySelector('.flower-ai-host').append(aiBtn);

  const aiDocumentsPanel = document.createElement("div");

aiDocumentsPanel.id = "aiDocumentsPanel";
aiDocumentsPanel.className = "ai-documents-panel";

aiDocumentsPanel.style.cssText = `
  width:100%;
  margin-top:10px;
  padding:12px;
  border:1px solid #e5e7eb;
  border-radius:12px;
  background:#f8fafc;
`;

aiDocumentsPanel.innerHTML = `
  <div
    style="
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:12px;
    "
  >
    <div>
      <div style="font-weight:700">
        Документы для анализа
      </div>

      <div
        id="aiDocumentsSummary"
        class="muted tiny"
        style="margin-top:3px"
      >
        Загружаю...
      </div>
    </div>

    <button
      type="button"
      id="aiDocumentsToggleBtn"
      class="link"
      style="
        white-space:nowrap;
        margin:0;
      "
    >
      Изменить
    </button>
  </div>

  <div
    id="aiDocumentsList"
    style="
      display:none;
      margin-top:10px;
    "
  >
    <div class="muted">
      Загружаю документы...
    </div>
  </div>
`;

actions.insertAdjacentElement(
  "afterend",
  aiDocumentsPanel
);

const aiDocumentsToggleBtn =
  document.getElementById('aiDocumentsToggleBtn');

const aiDocumentsList =
  document.getElementById('aiDocumentsList');

aiDocumentsToggleBtn.onclick = () => {
  const isOpen =
    aiDocumentsList.style.display !== 'none';

  aiDocumentsList.style.display =
    isOpen ? 'none' : 'block';

  aiDocumentsToggleBtn.textContent =
    isOpen ? 'Изменить' : 'Скрыть';
};

const aiDocumentTypeLabels = {
  mri_ct: 'МРТ / КТ',
  xray: 'Рентген',
  nsg: 'НСГ',
  eeg: 'ЭЭГ',
  enmg: 'ЭНМГ',
  ultrasound: 'УЗИ',
  doppler: 'Допплерография',
  doctor_report: 'Заключение врача',
  discharge: 'Выписка',
  labs: 'Анализы',
  genetic: 'Генетические исследования',
  other: 'Другое'
};

async function loadAiDocumentChoices() {
    if (!accountIsCurrent()) return;
  const aiDocumentsList =
    document.getElementById('aiDocumentsList');

  if (!aiDocumentsList) return;

  try {
    const { data, error } = await sb
      .from('patient_media')
      .select(
        'id, document_type, captured_at, created_at'
      )
      .eq('patient_id', p.id)
      .eq('media_type', 'document')
      .order('created_at', { ascending: false });
    if (!accountIsCurrent()) return;

    if (error) throw error;

    const documents = data || [];

    if (!documents.length) {
  const summary =
    document.getElementById('aiDocumentsSummary');

  const toggleBtn =
    document.getElementById('aiDocumentsToggleBtn');

  if (summary) {
    summary.textContent = 'Документов пока нет';
  }

  if (toggleBtn) {
    toggleBtn.style.display = 'none';
  }

  aiDocumentsList.innerHTML =
    '<div class="muted">Документов для анализа пока нет.</div>';

  return;
}

const toggleBtn =
  document.getElementById('aiDocumentsToggleBtn');

if (toggleBtn) {
  toggleBtn.style.display = '';
}

    if (
      !Array.isArray(
        state.aiDocumentIdsByPatient[p.id]
      )
    ) {
      state.aiDocumentIdsByPatient[p.id] =
        documents
          .slice(0, 3)
          .map(item => item.id);
    }

    const validIds = new Set(
      documents.map(item => item.id)
    );

    state.aiDocumentIdsByPatient[p.id] =
      state.aiDocumentIdsByPatient[p.id]
        .filter(id => validIds.has(id));

    const selectedIds =
      state.aiDocumentIdsByPatient[p.id];

      const aiDocumentsSummary =
  document.getElementById(
    'aiDocumentsSummary'
  );

if (aiDocumentsSummary) {
  aiDocumentsSummary.textContent =
    `Выбрано: ${selectedIds.length} из 3`;
}

    aiDocumentsList.innerHTML = `
      <div
        id="aiDocumentsCount"
        class="muted tiny"
        style="margin-bottom:8px"
      >
        Выбрано: ${selectedIds.length} из 3
      </div>

      ${documents
        .map(item => {
          const dateValue =
            item.captured_at || item.created_at;

          const dateText = dateValue
            ? new Date(dateValue)
                .toLocaleDateString('ru-RU')
            : 'Дата не указана';

          const checked =
            selectedIds.includes(item.id)
              ? 'checked'
              : '';

          return `
  <label
    style="
      display:grid;
      grid-template-columns:20px minmax(0, 1fr);
      align-items:center;
      gap:10px;
      padding:10px 0;
      margin:0;
      cursor:pointer;
      border-bottom:1px solid #e5e7eb;
    "
  >
    <input
      type="checkbox"
      data-ai-document-id="${item.id}"
      ${checked}
      style="
        width:18px;
        height:18px;
        min-width:18px;
        margin:0;
        padding:0;
      "
    >

    <span
      style="
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        min-width:0;
      "
    >
      <strong
        style="
          font-size:14px;
          text-align:left;
        "
      >
        ${
          aiDocumentTypeLabels[
            item.document_type
          ] || 'Документ'
        }
      </strong>

      <span
        class="muted tiny"
        style="
          white-space:nowrap;
          text-align:right;
        "
      >
        ${dateText}
      </span>
    </span>
  </label>
`;
        })
        .join('')}
    `;

    aiDocumentsList
      .querySelectorAll('[data-ai-document-id]')
      .forEach(checkbox => {
        checkbox.onchange = () => {
          const documentId =
            checkbox.dataset.aiDocumentId;

          let ids =
            state.aiDocumentIdsByPatient[p.id];

          if (checkbox.checked) {
            if (ids.length >= 3) {
              checkbox.checked = false;

              alert(
                'Для одного ИИ-анализа можно выбрать максимум 3 документа.'
              );

              return;
            }

            ids = [...ids, documentId];
          } else {
            ids = ids.filter(
              id => id !== documentId
            );
          }

          state.aiDocumentIdsByPatient[p.id] =
            ids;

          const count =
            document.getElementById(
              'aiDocumentsCount'
            );

          if (count) {
            count.textContent =
              `Выбрано: ${ids.length} из 3`;
          }

          const summary =
  document.getElementById(
    'aiDocumentsSummary'
  );

if (summary) {
  summary.textContent =
    `Выбрано: ${ids.length} из 3`;
}
        };
      });

  } catch (error) {
    if (!accountIsCurrent()) return;
    console.error(error);

    aiDocumentsList.innerHTML =
      '<div class="error">Не удалось загрузить список документов.</div>';
  }
}

loadAiDocumentChoices();

  const historyBtn = document.createElement("button");
  historyBtn.id = "aiHistoryBtn";
  historyBtn.className = "btn ai-history-button";
  historyBtn.textContent = "История анализов";

  actions.append(historyBtn);

  const aiResult = document.createElement("div");
  aiResult.className = "card ai-result-card";
  aiResult.style.display = "none";
  aiResult.style.marginTop = "12px";
  aiResult.style.whiteSpace = "pre-wrap";

  const aiToggleBtn = document.createElement("button");
aiToggleBtn.className = "btn full ai-result-toggle";
aiToggleBtn.type = "button";
aiToggleBtn.style.display = "none";
aiToggleBtn.style.marginTop = "12px";
aiToggleBtn.textContent = "Свернуть анализ";



function showAiResult(html) {
  aiResult.innerHTML = html;
  aiResult.style.display = "block";

  aiToggleBtn.style.display = "block";
  aiToggleBtn.textContent = "Свернуть анализ";
}

aiToggleBtn.onclick = () => {
  const isOpen = aiResult.style.display !== "none";

  if (isOpen) {
    aiResult.style.display = "none";
    aiToggleBtn.textContent = "Развернуть анализ";
  } else {
    aiResult.style.display = "block";
    aiToggleBtn.textContent = "Свернуть анализ";
  }
};

  const tabContent = document.getElementById("tabContent");
  tabContent.parentNode.insertBefore(aiResult, tabContent);

  aiResult.parentNode.insertBefore(aiToggleBtn, aiResult);

  const historyPanel = document.createElement("div");
  historyPanel.className = "card";
  historyPanel.style.display = "none";
  historyPanel.style.marginTop = "12px";

  aiResult.parentNode.insertBefore(historyPanel, aiResult);

  historyBtn.onclick = async () => {
    if (!accountIsCurrent()) return;
    if (historyPanel.style.display === "block") {
      historyPanel.style.display = "none";
      return;
    }

    historyBtn.disabled = true;
    historyBtn.textContent = "Загружаем…";

    try {
      const history = await loadAiAnalysisHistory(p.id);
    if (!accountIsCurrent()) return;

      historyPanel.innerHTML = "";

      const title = document.createElement("h3");
      title.textContent = "История анализов";
      historyPanel.appendChild(title);

      if (!history.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "Сохранённых анализов пока нет.";
        historyPanel.appendChild(empty);
      } else {
        history.forEach((item, index) => {
          const btn = document.createElement("button");
          btn.className = "btn full";
          btn.style.marginTop = "8px";

          const dateText =
            formatAIAnalysisDate(item.created_at) || "Дата неизвестна";

          btn.textContent =
            `${index === 0 ? "● " : ""}${dateText}` +
            `${index === 0 ? " — последний" : ""}`;

          btn.onclick = () => {
           showAiResult(
              formatAIAnalysisBlock(
                item.analysis,
                item.created_at,
                "Архивный анализ ИИ"
    )
  );
};

          historyPanel.appendChild(btn);
        });
      }

      historyPanel.style.display = "block";
    } catch (error) {
    if (!accountIsCurrent()) return;
      console.error(error);
      historyPanel.innerHTML =
        '<div class="muted">Не удалось загрузить историю анализов.</div>';
      historyPanel.style.display = "block";
    } finally {
      historyBtn.disabled = false;
      historyBtn.textContent = "История анализов";
    }
  };

  if (p.ai_analysis) {
    aiResult.innerHTML = formatAIAnalysisBlock(
  p.ai_analysis,
  p.ai_analysis_updated_at
);

aiResult.style.display = "none";
aiToggleBtn.style.display = "block";
  aiToggleBtn.textContent = "Развернуть анализ";
  

  aiBtn.textContent = "Обновить анализ";
  }

  aiBtn.onclick = async () => {
    if (!accountIsCurrent()) return;
    aiBtn.disabled = true;
    aiBtn.textContent = "Анализируем…";
    aiResult.style.display = "block";
    aiResult.textContent = "ИИ анализирует данные ребёнка...";

    try {
  const { data: documentRows, error: documentsError } = await sb
    .from('patient_media')
    .select('id, document_type, note, captured_at, created_at, storage_path')
    .eq('patient_id', p.id)
    .eq('media_type', 'document')
    .order('created_at', { ascending: false });
    if (!accountIsCurrent()) return;

  if (documentsError) throw documentsError;

  const allDocumentRows = documentRows || [];

let selectedIds =
  state.aiDocumentIdsByPatient[p.id];

if (!Array.isArray(selectedIds)) {
  selectedIds = allDocumentRows
    .slice(0, 3)
    .map(item => item.id);

  state.aiDocumentIdsByPatient[p.id] =
    selectedIds;
}

const selectedDocumentRows =
  allDocumentRows.filter(item =>
    selectedIds.includes(item.id)
  );

const documentsForAI =
  selectedDocumentRows.map(item => ({
    type: item.document_type || 'other',
    date: item.captured_at || item.created_at || null,
    note: item.note || null
  }));

const aiFiles = selectedDocumentRows
  .map(item => {
    if (!item.storage_path) return null;

    const lowerPath =
      item.storage_path.toLowerCase();

    return {
      storage_path: item.storage_path,
      kind: lowerPath.endsWith('.pdf')
        ? 'pdf'
        : 'image',
      label:
        aiDocumentTypeLabels[item.document_type] ||
        'Документ',
      date:
        item.captured_at ||
        item.created_at ||
        null
    };
  })
  .filter(Boolean);

  const patientData =
    buildGeneralAnalysisContext(
      p,
      documentsForAI
    );

      const prompt = `
Ты — клинический помощник детского физического терапевта.
Проанализируй данные ребёнка кратко, конкретно и только на основании предоставленной информации.

Правила:
- не ставь диагноз по недостаточным данным;
- не выдумывай отсутствующие сведения;
- чётко разделяй факты и предположения;
- если информации недостаточно — прямо укажи это;
- строго различай самостоятельное выполнение, выполнение с поддержкой,
  выполнение с опорой и выполнение с помощью специалиста;
- описание «не выполняет самостоятельно» совместимо с описанием
  «выполняет с поддержкой/опорой/помощью» и само по себе не является
  противоречием;
- называй сведения противоречивыми только тогда, когда они описывают
  одну и ту же функцию, один и тот же уровень помощи и сопоставимые
  условия или период, но содержат взаимоисключающие результаты;
- если уровень помощи, условия или период различаются либо не указаны,
  отмечай необходимость уточнения, а не утверждай противоречие;
- ориентируйся на функцию, активность и участие ребёнка;
- не повторяй одни и те же сведения;
- весь ответ должен быть компактным и пригодным для быстрого чтения специалистом.

Данные ребёнка:
${JSON.stringify(patientData, null, 2)}

Ответ строго по структуре:

## Краткое резюме
Максимум 3 коротких предложения.

## 📎 Данные из выбранных документов
Если к запросу приложены медицинские документы, обязательно разберись с каждым из них отдельно.

Для каждого приложенного документа:
- укажи тип документа;
- перечисли 1–5 ключевых фактов, которые действительно удалось прочитать непосредственно из файла;
- не смешивай факты документа с предположениями;
- если документ не удалось прочитать или изображение недостаточно разборчиво — прямо напиши об этом.

Не пропускай приложенный документ молча.
Если документов нет — напиши: "Документы не выбраны".

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

     const aiAnswer = await callAI("patient_analysis", p.id, {}, aiFiles);
    if (!accountIsCurrent()) return;

const usedDocumentsText = aiFiles.length
  ? aiFiles
      .map(file => {
        const dateText = file.date
          ? new Date(file.date).toLocaleDateString('ru-RU')
          : 'дата не указана';

        return `• ${file.label} — ${dateText}`;
      })
      .join('\n')
  : '• Документы не использовались';

const answer =
  `📎 Файлов передано ИИ: ${aiFiles.length} из ${selectedDocumentRows.length} выбранных\n` +
  `Использованы документы:\n${usedDocumentsText}\n\n` +
  aiAnswer;

      const analysisUpdatedAt = new Date().toISOString();

      const { error: saveAiError } = await sb
        .from("patients")
        .update({
          ai_analysis: answer,
          ai_analysis_updated_at: analysisUpdatedAt
        })
        .eq("id", p.id);
    if (!accountIsCurrent()) return;

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
    if (!accountIsCurrent()) return;

      if (historyError) {
        throw new Error(
          "Анализ сохранён в карточке, но добавить его в историю не удалось: " +
          historyError.message
        );
      }

      p.ai_analysis = answer;
      p.ai_analysis_updated_at = analysisUpdatedAt;

      showAiResult(
       formatAIAnalysisBlock(
        answer,
        analysisUpdatedAt
  )
);
      aiBtn.textContent = "✓ Анализ готов";

      setTimeout(() => {
      if (!accountIsCurrent()) return;
        aiBtn.textContent = p.ai_analysis
          ? "Обновить анализ"
          : "Анализ пациента";
        aiBtn.disabled = false;
      }, 1200);

    } catch (error) {
    if (!accountIsCurrent()) return;
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
    <div class="card assessment-card">
      <div class="assessment-intro"><div><h3>Первичная оценка</h3><div class="muted tiny">Заполняйте только применимые разделы — данные сохраняются в текущей форме.</div></div><span class="badge">${a?.id ? 'сохранена' : 'черновик'}</span></div>
      <div id="assessmentSectionProgress" class="assessment-progress">Заполнено разделов: 0 из 9</div>

      <div class="section-card">
        <div class="section-head"><div class="section-num">1</div><div class="section-title">Жалоба</div></div>
        <label>Основная жалоба</label><textarea name="complaint">${esc(a?.complaint || '')}</textarea>
        <div class="row"><div><label>Когда впервые заметили?</label><input name="noticed_when" value="${esc(compl.noticed_when || '')}" placeholder="например, 9 мес."></div><div><label>Динамика</label><select name="trend">${option('', 'Не указано', compl.trend)}${option('better', 'Лучше', compl.trend)}${option('same', 'Без изменений', compl.trend)}${option('worse', 'Хуже', compl.trend)}${option('variable', 'Нестабильно', compl.trend)}</select></div></div>
        <label>Что сейчас беспокоит родителей больше всего?</label><textarea name="main_concern">${esc(compl.main_concern || '')}</textarea>
        <label>Категории</label><input name="complaint_categories" value="${esc((compl.categories || []).join(', '))}" placeholder="носочки, стопы, баланс…">
      </div>

      <div class="section-card">
  <div class="section-head">
    <div class="section-num">2</div>
    <div class="section-title">Беременность, роды, анамнез</div>
  </div>

  <div class="row">
    <div>
      <label>Беременность по счёту</label>
      <input
        inputmode="numeric"
        name="pregnancy_number"
        value="${esc(hx.pregnancy_number || '')}"
      >
    </div>

    <div>
      <label>Срок рождения, нед.</label>
      <input
        inputmode="numeric"
        name="gestational_age"
        value="${esc(hx.gestational_age || '')}"
      >
    </div>
  </div>

  <label>Течение беременности</label>
  <textarea name="pregnancy_history">${esc(a?.pregnancy_history || '')}</textarea>

  <label>Роды / ранний период</label>
  <textarea name="birth_history">${esc(a?.birth_history || '')}</textarea>

  <div class="row">
    <div>
      <label>Способ родоразрешения</label>
      <select name="delivery_type">
        ${option('', 'Не указано', hx.delivery_type)}
        ${option('vaginal', 'Естественные роды', hx.delivery_type)}
        ${option('cesarean', 'Кесарево сечение', hx.delivery_type)}
        ${option('assisted', 'Оперативное вагинальное', hx.delivery_type)}
        ${option('other', 'Другое', hx.delivery_type)}
      </select>
    </div>

    <div>
      <label>Апгар</label>
      <input
        name="apgar"
        value="${esc(hx.apgar || '')}"
        placeholder="8 / 9"
      >
    </div>
  </div>

  <div class="row">
    <div>
      <label>Вес при рождении, г</label>
      <input
        inputmode="numeric"
        name="birth_weight"
        value="${esc(hx.birth_weight || '')}"
      >
    </div>

    <div>
      <label>Рост при рождении, см</label>
      <input
        inputmode="decimal"
        name="birth_length"
        value="${esc(hx.birth_length || '')}"
      >
    </div>
  </div>

  <label>Реанимация / ОРИТ / выхаживание</label>
  <select name="nicu">
    ${option('', 'Не указано', hx.nicu)}
    ${option('no', 'Нет', hx.nicu)}
    ${option('yes', 'Да', hx.nicu)}
    ${option('unknown', 'Неизвестно', hx.nicu)}
  </select>

  <label>Осложнения неонатального периода</label>
  <textarea
    name="neonatal_complications"
    placeholder="ИВЛ, гипоксия, желтуха, инфекции, судороги и др."
  >${esc(hx.neonatal_complications || '')}</textarea>

  <label>Диагнозы, операции, госпитализации</label>
  <textarea
    name="medical_history"
    placeholder="Основные диагнозы, операции, значимые госпитализации"
  >${esc(hx.medical_history || '')}</textarea>

  <label>Предыдущая реабилитация / физическая терапия</label>
  <textarea name="previous_rehab">${esc(hx.previous_rehab || '')}</textarea>
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
  <div class="section-head">
    <div class="section-num">4</div>
    <div class="section-title">Осмотр и спонтанная моторика</div>
  </div>

  <label>Основная запись осмотра</label>
  <textarea
    name="observation"
    placeholder="Опишите поведение ребёнка, ведущие двигательные особенности и функциональные ограничения"
  >${esc(a?.observation || '')}</textarea>

  <div class="row">
    <div>
      <label>Спонтанная двигательная активность</label>
      <select name="spontaneous_activity">
        ${option('', 'Не указано', obs.spontaneous_activity)}
        ${option('active', 'Активная', obs.spontaneous_activity)}
        ${option('reduced', 'Сниженная', obs.spontaneous_activity)}
        ${option('minimal', 'Минимальная', obs.spontaneous_activity)}
        ${option('variable', 'Нестабильная / вариабельная', obs.spontaneous_activity)}
        ${option('unclear', 'Трудно оценить', obs.spontaneous_activity)}
      </select>
    </div>

    <div>
      <label>Качество движений</label>
      <select name="movement_quality">
        ${option('', 'Не указано', obs.movement_quality)}
        ${option('smooth', 'Плавные / координированные', obs.movement_quality)}
        ${option('fragmented', 'Фрагментарные / затруднённые', obs.movement_quality)}
        ${option('stereotyped', 'Стереотипные', obs.movement_quality)}
        ${option('variable', 'Вариабельные', obs.movement_quality)}
        ${option('unclear', 'Трудно оценить', obs.movement_quality)}
      </select>
    </div>
  </div>

  <div class="row">
    <div>
      <label>Симметрия</label>
      <select name="symmetry">
        ${option('', 'Не указано', obs.symmetry)}
        ${option('yes', 'Симметрично', obs.symmetry)}
        ${option('no', 'Есть асимметрия', obs.symmetry)}
        ${option('unclear', 'Трудно оценить', obs.symmetry)}
      </select>
    </div>

    <div>
      <label>Использование сторон</label>
      <select name="side_use">
        ${option('', 'Не указано', obs.side_use)}
        ${option('symmetric', 'Симметричное', obs.side_use)}
        ${option('left', 'Преимущественно слева', obs.side_use)}
        ${option('right', 'Преимущественно справа', obs.side_use)}
        ${option('unclear', 'Трудно оценить', obs.side_use)}
      </select>
    </div>
  </div>

  <div class="row">
    <div>
      <label>Переходы</label>
      <select name="transitions">
        ${option('', 'Не указано', obs.transitions)}
        ${option('free', 'Свободные', obs.transitions)}
        ${option('limited', 'Ограниченные', obs.transitions)}
        ${option('absent', 'Самостоятельно не выполняет', obs.transitions)}
        ${option('unclear', 'Трудно оценить', obs.transitions)}
      </select>
    </div>

    <div>
      <label>Помощь при переходах</label>
      <select name="transition_assistance">
        ${option('', 'Не указано', obs.transition_assistance)}
        ${option('independent', 'Самостоятельно', obs.transition_assistance)}
        ${option('supervision', 'Только контроль / страховка', obs.transition_assistance)}
        ${option('minimal', 'Минимальная помощь', obs.transition_assistance)}
        ${option('moderate', 'Умеренная помощь', obs.transition_assistance)}
        ${option('maximal', 'Значительная помощь', obs.transition_assistance)}
        ${option('dependent', 'Полностью зависит от помощи', obs.transition_assistance)}
      </select>
    </div>
  </div>

  <div class="row">
    <div>
      <label>Постуральный контроль</label>
      <select name="postural_control">
        ${option('', 'Не указано', obs.postural_control)}
        ${option('good', 'Хороший', obs.postural_control)}
        ${option('limited', 'Ограниченный', obs.postural_control)}
        ${option('poor', 'Выраженно нарушен', obs.postural_control)}
        ${option('unclear', 'Трудно оценить', obs.postural_control)}
      </select>
    </div>

    <div>
      <label>Выносливость / утомляемость</label>
      <select name="endurance">
        ${option('', 'Не указано', obs.endurance)}
        ${option('good', 'Хорошая', obs.endurance)}
        ${option('reduced', 'Сниженная', obs.endurance)}
        ${option('rapid_fatigue', 'Быстро утомляется', obs.endurance)}
        ${option('unclear', 'Трудно оценить', obs.endurance)}
      </select>
    </div>
  </div>
</div>
       

      <div class="section-card">
  <div class="section-head">
    <div class="section-num">5</div>
    <div class="section-title">Положение тела</div>
  </div>

  <div class="row">
    <div>
      <label>Основное положение осмотра</label>
      <select name="assessment_position">
        ${option('', 'Не указано', body.assessment_position)}
        ${option('supine', 'Лёжа на спине', body.assessment_position)}
        ${option('prone', 'Лёжа на животе', body.assessment_position)}
        ${option('sitting', 'Сидя', body.assessment_position)}
        ${option('standing', 'Стоя', body.assessment_position)}
        ${option('mixed', 'Несколько положений', body.assessment_position)}
      </select>
    </div>

    <div>
      <label>Положение головы</label>
      <select name="head_alignment">
        ${option('', 'Не указано', body.head_alignment)}
        ${option('midline', 'По средней линии', body.head_alignment)}
        ${option('tilt_left', 'Наклон влево', body.head_alignment)}
        ${option('tilt_right', 'Наклон вправо', body.head_alignment)}
        ${option('rotation_left', 'Ротация влево', body.head_alignment)}
        ${option('rotation_right', 'Ротация вправо', body.head_alignment)}
        ${option('variable', 'Положение меняется', body.head_alignment)}
        ${option('unclear', 'Трудно оценить', body.head_alignment)}
      </select>
    </div>
  </div>

  <div class="row">
    <div>
      <label>Плечевой пояс</label>
      <select name="shoulder_alignment">
        ${option('', 'Не указано', body.shoulder_alignment)}
        ${option('symmetric', 'Симметричный', body.shoulder_alignment)}
        ${option('left_high', 'Левое плечо выше', body.shoulder_alignment)}
        ${option('right_high', 'Правое плечо выше', body.shoulder_alignment)}
        ${option('protracted', 'Плечи преимущественно вперёд', body.shoulder_alignment)}
        ${option('retracted', 'Плечи преимущественно назад', body.shoulder_alignment)}
        ${option('asymmetric', 'Другая асимметрия', body.shoulder_alignment)}
        ${option('unclear', 'Трудно оценить', body.shoulder_alignment)}
      </select>
    </div>

    <div>
      <label>Туловище</label>
      <select name="trunk_alignment">
        ${option('', 'Не указано', body.trunk_alignment)}
        ${option('neutral', 'Относительно нейтрально', body.trunk_alignment)}
        ${option('flexion', 'Преобладает сгибание', body.trunk_alignment)}
        ${option('extension', 'Преобладает разгибание', body.trunk_alignment)}
        ${option('lateral_left', 'Наклон влево', body.trunk_alignment)}
        ${option('lateral_right', 'Наклон вправо', body.trunk_alignment)}
        ${option('rotation', 'Выражена ротация', body.trunk_alignment)}
        ${option('asymmetric', 'Другая асимметрия', body.trunk_alignment)}
        ${option('unclear', 'Трудно оценить', body.trunk_alignment)}
      </select>
    </div>
  </div>

  <label>Положение таза</label>
  <select name="pelvis_alignment">
    ${option('', 'Не указано', body.pelvis_alignment)}
    ${option('neutral', 'Относительно нейтральное', body.pelvis_alignment)}
    ${option('anterior_tilt', 'Передний наклон', body.pelvis_alignment)}
    ${option('posterior_tilt', 'Задний наклон', body.pelvis_alignment)}
    ${option('left_high', 'Левая сторона выше', body.pelvis_alignment)}
    ${option('right_high', 'Правая сторона выше', body.pelvis_alignment)}
    ${option('rotation', 'Ротация таза', body.pelvis_alignment)}
    ${option('asymmetric', 'Другая асимметрия', body.pelvis_alignment)}
    ${option('unclear', 'Трудно оценить', body.pelvis_alignment)}
  </select>

  <details style="margin-top:14px">
    <summary style="cursor:pointer;font-weight:600">
      Подробное описание положения тела
    </summary>

    <label>Голова / шея</label>
    <textarea name="head_neck">${esc(body.head_neck || '')}</textarea>

    <label>Плечевой пояс</label>
    <textarea name="shoulders">${esc(body.shoulders || '')}</textarea>

    <label>Туловище</label>
    <textarea name="trunk">${esc(body.trunk || '')}</textarea>

    <label>Таз</label>
    <textarea name="pelvis">${esc(body.pelvis || '')}</textarea>

    <label>Тазобедренные суставы / бёдра</label>
    <textarea name="hips">${esc(body.hips || '')}</textarea>

    <label>Колени</label>
    <textarea name="knees">${esc(body.knees || '')}</textarea>

    <label>Стопы</label>
    <textarea name="feet">${esc(body.feet || '')}</textarea>
  </details>
</div>
        

    <div class="section-card">
  <div class="section-head">
    <div class="section-num">6</div>
    <div class="section-title">Голеностоп и опора стоп</div>
  </div>

  <div class="help">
    Дорсифлексию указывайте в градусах. При возможности измеряйте отдельно при согнутом и разогнутом колене.
  </div>

  <div class="row">
    <div>
      <label>Дорсифлексия R, колено согнуто, °</label>
      <input
        inputmode="decimal"
        name="df_right_flexed"
        value="${esc(ankle.df_right_flexed || '')}"
      >
    </div>

    <div>
      <label>Дорсифлексия L, колено согнуто, °</label>
      <input
        inputmode="decimal"
        name="df_left_flexed"
        value="${esc(ankle.df_left_flexed || '')}"
      >
    </div>
  </div>

  <div class="row">
    <div>
      <label>Дорсифлексия R, колено разогнуто, °</label>
      <input
        inputmode="decimal"
        name="df_right_extended"
        value="${esc(ankle.df_right_extended || '')}"
      >
    </div>

    <div>
      <label>Дорсифлексия L, колено разогнуто, °</label>
      <input
        inputmode="decimal"
        name="df_left_extended"
        value="${esc(ankle.df_left_extended || '')}"
      >
    </div>
  </div>

  <div class="row">
    <div>
      <label>Опора R</label>
      <select name="foot_support_right">
        ${option('', 'Не указано', ankle.foot_support_right)}
        ${option('full', 'Полная стопа', ankle.foot_support_right)}
        ${option('forefoot', 'Передний отдел', ankle.foot_support_right)}
        ${option('lateral', 'Преимущественно наружный край', ankle.foot_support_right)}
        ${option('medial', 'Преимущественно внутренний край', ankle.foot_support_right)}
        ${option('variable', 'Вариабельная', ankle.foot_support_right)}
        ${option('other', 'Другое', ankle.foot_support_right)}
      </select>
    </div>

    <div>
      <label>Опора L</label>
      <select name="foot_support_left">
        ${option('', 'Не указано', ankle.foot_support_left)}
        ${option('full', 'Полная стопа', ankle.foot_support_left)}
        ${option('forefoot', 'Передний отдел', ankle.foot_support_left)}
        ${option('lateral', 'Преимущественно наружный край', ankle.foot_support_left)}
        ${option('medial', 'Преимущественно внутренний край', ankle.foot_support_left)}
        ${option('variable', 'Вариабельная', ankle.foot_support_left)}
        ${option('other', 'Другое', ankle.foot_support_left)}
      </select>
    </div>
  </div>

  <div class="row">
    <div>
      <label>Пятка R</label>
      <select name="heel_right">
        ${option('', 'Не указано', ankle.heel_right)}
        ${option('neutral', 'Нейтрально', ankle.heel_right)}
        ${option('valgus', 'Вальгус', ankle.heel_right)}
        ${option('varus', 'Варус', ankle.heel_right)}
        ${option('no_contact', 'Нет контакта пяткой', ankle.heel_right)}
      </select>
    </div>

    <div>
      <label>Пятка L</label>
      <select name="heel_left">
        ${option('', 'Не указано', ankle.heel_left)}
        ${option('neutral', 'Нейтрально', ankle.heel_left)}
        ${option('valgus', 'Вальгус', ankle.heel_left)}
        ${option('varus', 'Варус', ankle.heel_left)}
        ${option('no_contact', 'Нет контакта пяткой', ankle.heel_left)}
      </select>
    </div>
  </div>

  <label>Комментарий по стопам / голеностопу</label>
  <textarea
    name="ankle_notes"
    placeholder="Например: эквинус справа выражен больше, при поддержке пятка опускается..."
  >${esc(ankle.notes || '')}</textarea>
</div>
      <div class="section-card">
  <div class="section-head">
    <div class="section-num">7</div>
    <div class="section-title">Неврологические признаки</div>
  </div>

  <div class="help">
    Отмечайте только фактически наблюдаемые или проверенные признаки.
  </div>

  <div class="row">
    <div>
      <label>Тонус рук</label>
      <select name="tone_arms">
        ${option('', 'Не оценён', neuro.tone_arms)}
        ${option('normal', 'Без явных особенностей', neuro.tone_arms)}
        ${option('high', 'Повышен', neuro.tone_arms)}
        ${option('low', 'Снижен', neuro.tone_arms)}
        ${option('asymmetry', 'Асимметрия', neuro.tone_arms)}
        ${option('variable', 'Вариабельный', neuro.tone_arms)}
      </select>
    </div>

    <div>
      <label>Тонус ног</label>
      <select name="tone_legs">
        ${option('', 'Не оценён', neuro.tone_legs)}
        ${option('normal', 'Без явных особенностей', neuro.tone_legs)}
        ${option('high', 'Повышен', neuro.tone_legs)}
        ${option('low', 'Снижен', neuro.tone_legs)}
        ${option('asymmetry', 'Асимметрия', neuro.tone_legs)}
        ${option('variable', 'Вариабельный', neuro.tone_legs)}
      </select>
    </div>
  </div>

  <label>Характер изменения тонуса</label>
  <select name="tone_pattern">
    ${option('', 'Не указано', neuro.tone_pattern)}
    ${option('spastic', 'Преимущественно спастический', neuro.tone_pattern)}
    ${option('dystonic', 'Преимущественно дистонический', neuro.tone_pattern)}
    ${option('mixed', 'Смешанный', neuro.tone_pattern)}
    ${option('hypotonic', 'Преимущественно гипотонический', neuro.tone_pattern)}
    ${option('unclear', 'Трудно классифицировать', neuro.tone_pattern)}
  </select>

  <label>Сухожильные рефлексы</label>
  <input
    name="reflexes"
    value="${esc(neuro.reflexes || '')}"
    placeholder="Например: оживлены симметрично, справа выше"
  >

  <div class="row">
    <div>
      <label>Клонус справа</label>
      <select name="clonus_right">
        ${option('', 'Не проверял', neuro.clonus_right)}
        ${option('none', 'Нет', neuro.clonus_right)}
        ${option('unsustained', 'Несколько колебаний', neuro.clonus_right)}
        ${option('sustained', 'Устойчивый', neuro.clonus_right)}
      </select>
    </div>

    <div>
      <label>Клонус слева</label>
      <select name="clonus_left">
        ${option('', 'Не проверял', neuro.clonus_left)}
        ${option('none', 'Нет', neuro.clonus_left)}
        ${option('unsustained', 'Несколько колебаний', neuro.clonus_left)}
        ${option('sustained', 'Устойчивый', neuro.clonus_left)}
      </select>
    </div>
  </div>

  <label>Подошвенный ответ</label>
  <input
    name="plantar"
    value="${esc(neuro.plantar || '')}"
  >

  <label>Непроизвольные движения / дистонические проявления</label>
  <select name="involuntary_movements">
    ${option('', 'Не указано', neuro.involuntary_movements)}
    ${option('none', 'Не наблюдаются', neuro.involuntary_movements)}
    ${option('present', 'Наблюдаются', neuro.involuntary_movements)}
    ${option('variable', 'Эпизодические / вариабельные', neuro.involuntary_movements)}
    ${option('unclear', 'Трудно оценить', neuro.involuntary_movements)}
  </select>

  <label>Другие наблюдения</label>
  <textarea name="neuro_observations">${esc(a?.neuro_observations || '')}</textarea>
</div>

     <div class="section-card">
  <div class="section-head">
    <div class="section-num">8</div>
    <div class="section-title">Стандартизированные оценки</div>
  </div>

  <div class="help">
    Заполняйте только те классификации и шкалы, которые реально применялись.
  </div>

  <div class="row">
    <div>
      <label>GMFCS</label>
      <select name="gmfcs">
        ${option('', 'Не оценено', tests.gmfcs)}
        ${option('I', 'I', tests.gmfcs)}
        ${option('II', 'II', tests.gmfcs)}
        ${option('III', 'III', tests.gmfcs)}
        ${option('IV', 'IV', tests.gmfcs)}
        ${option('V', 'V', tests.gmfcs)}
      </select>
    </div>

    <div>
      <label>MACS</label>
      <select name="macs">
        ${option('', 'Не оценено', tests.macs)}
        ${option('I', 'I', tests.macs)}
        ${option('II', 'II', tests.macs)}
        ${option('III', 'III', tests.macs)}
        ${option('IV', 'IV', tests.macs)}
        ${option('V', 'V', tests.macs)}
      </select>
    </div>
  </div>

  <div class="row">
    <div>
      <label>CFCS</label>
      <select name="cfcs">
        ${option('', 'Не оценено', tests.cfcs)}
        ${option('I', 'I', tests.cfcs)}
        ${option('II', 'II', tests.cfcs)}
        ${option('III', 'III', tests.cfcs)}
        ${option('IV', 'IV', tests.cfcs)}
        ${option('V', 'V', tests.cfcs)}
      </select>
    </div>

    <div>
      <label>EDACS</label>
      <select name="edacs">
        ${option('', 'Не оценено', tests.edacs)}
        ${option('I', 'I', tests.edacs)}
        ${option('II', 'II', tests.edacs)}
        ${option('III', 'III', tests.edacs)}
        ${option('IV', 'IV', tests.edacs)}
        ${option('V', 'V', tests.edacs)}
      </select>
    </div>
  </div>

  <div class="row">
    <div>
      <label>HINE, баллы</label>
      <input
        inputmode="decimal"
        name="hine_score"
        value="${esc(tests.hine_score || '')}"
        placeholder="например, 58"
      >
    </div>

    <div>
      <label>Дата HINE</label>
      <input
        type="date"
        name="hine_date"
        value="${esc(tests.hine_date || '')}"
      >
    </div>
  </div>

  <div class="row">
    <div>
      <label>GMFM-66, баллы</label>
      <input
        inputmode="decimal"
        name="gmfm66_score"
        value="${esc(tests.gmfm66_score || '')}"
        placeholder="например, 52.4"
      >
    </div>

    <div>
      <label>Дата GMFM</label>
      <input
        type="date"
        name="gmfm66_date"
        value="${esc(tests.gmfm66_date || '')}"
      >
    </div>
  </div>

  <label>Другой инструмент / шкала</label>
  <input
    name="test_name"
    value="${esc(tests.name || '')}"
    placeholder="например, PEDI-CAT, AIMS, TIMP"
  >

  <label>Результат / комментарий</label>
  <textarea name="test_result">${esc(tests.result || '')}</textarea>

  <details
  style="
    margin-top:18px;
    padding-top:16px;
    border-top:1px solid #e5e7eb;
  "
>
  <summary
    style="
      font-weight:700;
      cursor:pointer;
      user-select:none;
      padding:4px 0 10px;
    "
  >
    📈 История и динамика оценок
  </summary>

  <div class="row">
    <div>
      <label>Дата записи</label>
      <input
        type="date"
        id="standardizedHistoryDate"
      >
    </div>

    <div style="display:flex;align-items:flex-end">
      <button
        type="button"
        id="saveStandardizedHistoryBtn"
        class="btn"
        style="width:100%"
      >
        + Добавить текущие результаты
      </button>
    </div>
  </div>

  <div
    id="standardizedHistoryStatus"
    class="save-status"
  ></div>

  <div
    id="standardizedHistoryList"
    style="margin-top:12px"
  >
    <div class="muted">
      Загружаю историю оценок...
    </div>
  </div>
  <div
  id="standardizedCharts"
  style="
    margin-top:18px;
    padding-top:16px;
    border-top:1px solid #e5e7eb;
  "
>
  <div
    style="
      font-weight:700;
      margin-bottom:10px;
    "
  >
    📊 Динамика показателей
  </div>

  <div
    id="gmfm66Chart"
    style="margin-bottom:18px"
  >
    <div class="muted">
      Для графика GMFM-66 нужно минимум 2 измерения.
    </div>
  </div>

  <div id="hineChart">
    <div class="muted">
      Для графика HINE нужно минимум 2 измерения.
    </div>
  </div>
</div>
</details>
</div>
        
<div class="section-card">
  <div class="section-head">
    <div class="section-num">9</div>
    <div class="section-title">Физиотерапевтическое заключение</div>
  </div>

  <div class="help">
    Кратко сформулируйте ведущие функциональные проблемы, возможности ребёнка и основные направления физической терапии.
  </div>

  <textarea
    name="conclusion"
    placeholder="Например: самостоятельное сидение сохранено, переход сидя–стоя требует помощи; ограничение самостоятельного передвижения связано с недостаточным постуральным контролем и нарушением опоры стоп..."
    style="min-height:150px"
  >${esc(a?.conclusion || '')}</textarea>
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
    history: {
  pregnancy_number: formValue(fd, 'pregnancy_number'),
  gestational_age: formValue(fd, 'gestational_age'),
  delivery_type: formValue(fd, 'delivery_type'),
  birth_weight: formValue(fd, 'birth_weight'),
  birth_length: formValue(fd, 'birth_length'),
  apgar: formValue(fd, 'apgar'),
  nicu: formValue(fd, 'nicu'),
  neonatal_complications: formValue(fd, 'neonatal_complications'),
  medical_history: formValue(fd, 'medical_history'),
  previous_rehab: formValue(fd, 'previous_rehab')
},
    milestones: milestonesFromForm(fd),
    observation: {
  spontaneous_activity: formValue(fd, 'spontaneous_activity'),
  movement_quality: formValue(fd, 'movement_quality'),
  symmetry: formValue(fd, 'symmetry'),
  side_use: formValue(fd, 'side_use'),
  transitions: formValue(fd, 'transitions'),
  transition_assistance: formValue(fd, 'transition_assistance'),
  postural_control: formValue(fd, 'postural_control'),
  endurance: formValue(fd, 'endurance')
},

    body: {
  assessment_position: formValue(fd, 'assessment_position'),
  head_alignment: formValue(fd, 'head_alignment'),
  shoulder_alignment: formValue(fd, 'shoulder_alignment'),
  trunk_alignment: formValue(fd, 'trunk_alignment'),
  pelvis_alignment: formValue(fd, 'pelvis_alignment'),

  head_neck: formValue(fd, 'head_neck'),
  shoulders: formValue(fd, 'shoulders'),
  trunk: formValue(fd, 'trunk'),
  pelvis: formValue(fd, 'pelvis'),
  hips: formValue(fd, 'hips'),
  knees: formValue(fd, 'knees'),
  feet: formValue(fd, 'feet')
},
   ankle: {
  df_right_flexed: formValue(fd, 'df_right_flexed'),
  df_left_flexed: formValue(fd, 'df_left_flexed'),
  df_right_extended: formValue(fd, 'df_right_extended'),
  df_left_extended: formValue(fd, 'df_left_extended'),

  foot_support_right: formValue(fd, 'foot_support_right'),
  foot_support_left: formValue(fd, 'foot_support_left'),

  heel_right: formValue(fd, 'heel_right'),
  heel_left: formValue(fd, 'heel_left'),

  notes: formValue(fd, 'ankle_notes')
},
    neuro: {
  tone_arms: formValue(fd, 'tone_arms'),
  tone_legs: formValue(fd, 'tone_legs'),
  tone_pattern: formValue(fd, 'tone_pattern'),

  reflexes: formValue(fd, 'reflexes'),

  clonus_right: formValue(fd, 'clonus_right'),
  clonus_left: formValue(fd, 'clonus_left'),

  plantar: formValue(fd, 'plantar'),

  involuntary_movements: formValue(fd, 'involuntary_movements')
},
    tests: {
  gmfcs: formValue(fd, 'gmfcs'),
  macs: formValue(fd, 'macs'),
  cfcs: formValue(fd, 'cfcs'),
  edacs: formValue(fd, 'edacs'),

  hine_score: formValue(fd, 'hine_score'),
  hine_date: formValue(fd, 'hine_date'),

  gmfm66_score: formValue(fd, 'gmfm66_score'),
  gmfm66_date: formValue(fd, 'gmfm66_date'),

  name: formValue(fd, 'test_name'),
  result: formValue(fd, 'test_result')
},
  };
}

function renderTab(p, parentInvitationSent = false, navigateSection = null) {
  const accountRevision = authViewRevision, accountUserId = user?.id;
  const accountPatientId = p.id;
  const renderedSection = state.tab;
  let box;
  const accountIsCurrent = () => accountRevision === authViewRevision && accountUserId === user?.id && state.patientId === accountPatientId && box?.isConnected && roleGate.canNavigate();

  box = document.getElementById('tabContent');
  const refreshParentControls = async invitationSent => {
    if (!accountIsCurrent()) return;
    await loadPatientData();
    if (!accountIsCurrent()) return;
    if (navigateSection?.refresh) await navigateSection.refresh(renderedSection, invitationSent === true);
    else renderPatient(invitationSent === true);
  };
  if (state.tab === 'parent') {
    renderParentPortalSpecialist({ root: box, sb, user: { id: accountUserId }, patient: p, contacts: state.contacts, storageOrigin: SUPABASE_URL, isCurrent: accountIsCurrent, refresh: refreshParentControls, invitationSent: parentInvitationSent === true, manageGoals: () => { if (accountIsCurrent()) { if (navigateSection) return navigateSection('goals'); state.tab = 'goals'; renderPatient(); } } });
    return;
  }
let editingContactId = null;
if (state.tab === 'overview') {
  box.insertAdjacentHTML('beforeend', patientOverviewHtml({patientId:p.id, goals:state.goals, sessions:state.sessions, reports:state.parentReports, sessionReports:state.parentSessionReports}));
  const overviewRoot = box.querySelector('.patient-overview');
  const reportRoot = document.createElement('div');
  box.append(reportRoot);
  mountParentReportWorkspace({
    root: reportRoot, sb, patient: p,
    specialist: {id: accountUserId, full_name: state.profile?.full_name || user.user_metadata?.full_name || user.user_metadata?.name || user.email || ''},
    profile: state.profile || {}, reports: state.parentReports,
    prepareDraft: () => prepareParentReportDraft(accountPatientId), isCurrent: accountIsCurrent,
    onSaved(report) {
      if (!accountIsCurrent()) return;
      const index = state.parentReports.findIndex(row => row.id === report.id);
      if (index < 0) state.parentReports.unshift(report); else state.parentReports[index] = report;
      updateOverviewReport(overviewRoot,{patientId:p.id,reports:state.parentReports,sessionReports:state.parentSessionReports});
    },
    onDeleted(reportId) {
      if (accountIsCurrent()) state.parentReports = state.parentReports.filter(row => row.id !== reportId);
      if (accountIsCurrent()) updateOverviewReport(overviewRoot,{patientId:p.id,reports:state.parentReports,sessionReports:state.parentSessionReports});
    }
  });
  const navigateFromOverview = async (tab,addGoal) => {
      if (!accountIsCurrent()) return false;
      if (navigateSection) {
        if (!await navigateSection(tab)) return false;
      } else {
        if (!await leaveParentReportWorkspace(app) || !accountIsCurrent()) return false;
        saveFlowerCompact(window,true); state.tab = tab; renderPatient();
      }
      if (addGoal && document.getElementById('goalForm')?.hidden) document.getElementById('goalFormToggle')?.click();
      const destination = addGoal ? document.querySelector('#goalForm [name="title"]') : app.querySelector(`[data-tab="${tab}"]`);
      destination?.focus({preventScroll:true});
      document.getElementById('tabContent')?.scrollIntoView({block:'start'});
      return true;
  };
  mountPatientOverview({
    root:overviewRoot, sb, patient:p, user:{id:accountUserId}, isCurrent:accountIsCurrent,
    getOverviewData:() => ({patientId:p.id,goals:state.goals,sessions:state.sessions,reports:state.parentReports,sessionReports:state.parentSessionReports}),
    navigate:navigateFromOverview,
    onSessionReports:rows => {
      if (!accountIsCurrent()) return;
      state.parentSessionReports = rows;
      updateOverviewReport(overviewRoot,{patientId:p.id,reports:state.parentReports,sessionReports:rows});
    },
    openReport:async (reportId,kind,sessionId) => {
      if (!accountIsCurrent()) return;
      if (kind === 'session') {
        if (!await navigateFromOverview('sessions')) return;
        const button = [...app.querySelectorAll('[data-parent-session]')].find(b => b.dataset.parentSession === sessionId);
        if (!button) return;
        button.closest('details').open = true;
        await button.onclick(undefined,reportId);
        if (accountRevision !== authViewRevision || accountUserId !== user?.id || state.patientId !== p.id) return;
        const editor = app.querySelector('[data-parent-session-editor]');
        editor?.querySelector('textarea')?.focus({preventScroll:true});
        editor?.scrollIntoView({block:'start'});
        return;
      }
      const button = reportId
        ? [...reportRoot.querySelectorAll('[data-open-parent-report]')].find(b => b.dataset.openParentReport === reportId)
        : reportRoot.querySelector('[data-start-report]');
      if (button) await button.onclick();
      if (accountIsCurrent()) reportRoot.scrollIntoView({block:'start'});
    },
    openAppointment:async (row,onSaved) => {
      const appointments = [];
      // The existing picker can replace the patient; preserve complete balances for every selection.
      for (let offset=0; ; offset+=500) {
        const {data,error} = await sb.from('appointments').select('*').eq('therapist_id',accountUserId).order('id').range(offset,offset+499);
        if (!accountIsCurrent()) return;
        if (error) throw error;
        appointments.push(...(data || []));
        if ((data || []).length < 500) break;
      }
      if (!accountIsCurrent()) return;
      openScheduleEditor({app:box, sb, user:{id:accountUserId}, patients:state.patients, appointments, row, patientId:p.id, esc, isCurrent:accountIsCurrent,
        onSaved:async () => {
          if (!accountIsCurrent()) return;
          await loadPatients();
          if (accountIsCurrent()) await onSaved();
        }
      });
    }
  });
}

 box.insertAdjacentHTML('beforeend', `
  <div class="card contacts-workspace" style="margin-top:12px">
    <div
      class="contacts-workspace-heading"
      style="
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:12px;
      "
    >
      <div>
      <div class="workspace-eyebrow">Связь с семьёй</div>
      <h3 style="margin:0">
        Контакты родителей / представителей
      </h3>
      <p class="contacts-workspace-help">Основной контакт всегда находится первым в списке.</p>
      </div>

      <button
        type="button"
        class="btn small contacts-add-button"
        id="addContactBtn"
      >
        + Контакт
      </button>
    </div>

    <div class="contact-card-list" style="margin-top:10px">
      ${
        (state.contacts || []).length
          ? (state.contacts || [])
              .map(contact => `
                <article class="item contact-card">
                  <div class="item-title">
                    ${esc(contact.full_name)}
                    ${
                      contact.is_primary
                        ? '<span class="badge">Основной</span>'
                        : ''
                    }
                  </div>

                  ${
                    contact.relation
                      ? `<div class="item-sub">${esc(contact.relation)}</div>`
                      : ''
                  }

                  ${
                    contact.phone
                      ? `<div class="item-sub contact-phone">${esc(contact.phone)}</div>`
                      : ''
                  }

                  ${
                    contact.email
                      ? `<div class="item-sub contact-email">${esc(contact.email)}</div>`
                      : ''
                  }

                  ${
                    contact.telegram
                      ? `<div class="item-sub contact-telegram">${esc(contact.telegram)}</div>`
                      : ''
                  }

<div
  class="contact-card-actions"
  style="
    display:flex;
    gap:12px;
    flex-wrap:wrap;
    margin-top:8px;
  "
>
  ${
    contact.phone
      ? `
        <button
          type="button"
          class="link"
          data-call-contact="${contact.id}"
        >
          Позвонить
        </button>

        <button
          type="button"
          class="link"
          data-sms-contact="${contact.id}"
        >
          SMS
        </button>
      `
      : ''
  }

  ${
    contact.telegram
      ? `
        <button
          type="button"
          class="link"
          data-telegram-contact="${contact.id}"
        >
          Telegram
        </button>
      `
      : ''
  }

  <button
    type="button"
    class="link"
    data-edit-contact="${contact.id}"
  >
    Изменить
  </button>

  <button
    type="button"
    class="link"
    data-delete-contact="${contact.id}"
    style="color:#c62828"
  >
    Удалить
  </button>
</div>

                </article>
              `)
              .join('')
          : '<div class="empty contact-empty-state">Контакты пока не добавлены.</div>'
      }
    </div>
  </div>
`);

box.insertAdjacentHTML('beforeend', `
  <div
    id="contactFormWrap"
    class="card contact-form-card"
    style="
      margin-top:12px;
      display:none;
    "
  >
    <header class="contact-form-heading">
      <div>
        <div class="workspace-eyebrow">Контакт</div>
        <h3>Новый контакт</h3>
        <p>Укажите способы связи, согласованные с семьёй.</p>
      </div>
    </header>

    <form id="contactForm" class="contact-form">
      <label>Имя родителя / представителя</label>
      <input
        name="full_name"
        required
        placeholder="Например: Марина"
      >

      <label>Кем приходится ребёнку</label>
      <input
        name="relation"
        placeholder="Например: мама"
      >

      <label>Телефон</label>
      <input
        name="phone"
        type="tel"
        placeholder="+7..."
      >

      <label>Email</label>
      <input name="email" type="email" maxlength="254" placeholder="anna@example.test">

      <label>Telegram</label>
      <input
        name="telegram"
        placeholder="@username"
      >

      <label class="contact-primary-check">
        <input
          name="is_primary"
          type="checkbox"
          style="width:auto"
        >
        Основной контакт
      </label>

      <div class="contact-form-actions">
        <button
          type="submit"
          class="btn primary full"
          id="contactSaveBtn"
        >
          Сохранить контакт
        </button>

        <button
          type="button"
          class="btn full"
          id="contactCancelBtn"
        >
          Отмена
        </button>
      </div>

      <div
        id="contactStatus"
        class="save-status contact-save-status"
      ></div>
    </form>
  </div>
`);

const addContactBtn =
  document.getElementById('addContactBtn');

const contactFormWrap =
  document.getElementById('contactFormWrap');

const contactCancelBtn =
  document.getElementById('contactCancelBtn');

const contactForm =
  document.getElementById('contactForm');

const setContactStatus = (status, message) => {
  const statusEl = document.getElementById('contactStatus');
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.state = status;
};

const resetContactForm = () => {
  if (contactForm) contactForm.reset();
  editingContactId = null;

  const formTitle = contactFormWrap?.querySelector('h3');
  const contactSaveBtn = document.getElementById('contactSaveBtn');

  if (formTitle) formTitle.textContent = 'Новый контакт';
  if (contactSaveBtn) contactSaveBtn.textContent = 'Сохранить контакт';
  setContactStatus('', '');
};

editingContactId = null;

if (addContactBtn && contactFormWrap) {
  addContactBtn.onclick = () => {
    resetContactForm();
    contactFormWrap.style.display = 'block';

    contactFormWrap.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  };
}

if (contactCancelBtn && contactFormWrap) {
  contactCancelBtn.onclick = () => {
    resetContactForm();
    contactFormWrap.style.display = 'none';
  };
}

if (contactForm) {
  contactForm.onsubmit = async e => {
    if (!accountIsCurrent()) return;
    e.preventDefault();

    const contactSaveBtn =
      document.getElementById('contactSaveBtn');

    const fd = new FormData(contactForm);

    const payload = {
      patient_id: p.id,
      therapist_id: user.id,
      full_name: String(fd.get('full_name') || '').trim(),
      relation: String(fd.get('relation') || '').trim() || null,
      phone: String(fd.get('phone') || '').trim() || null,
      email: String(fd.get('email') || '').trim().toLowerCase() || null,
      telegram: String(fd.get('telegram') || '').trim() || null,
      is_primary: fd.get('is_primary') === 'on'
    };

    contactSaveBtn.disabled = true;
    contactSaveBtn.textContent = 'Сохраняю...';

    setContactStatus('saving', 'Сохраняем контакт…');

    if (payload.is_primary) {
      const { error: resetPrimaryError } = await sb
        .from('patient_contacts')
        .update({ is_primary: false })
        .eq('patient_id', p.id)
        .eq('therapist_id', user.id);
    if (!accountIsCurrent()) return;

      if (resetPrimaryError) {
        console.error('Ошибка выбора основного контакта:', resetPrimaryError);
        contactSaveBtn.disabled = false;
        contactSaveBtn.textContent = 'Сохранить контакт';
        setContactStatus('error', 'Не удалось выбрать основной контакт. Повторите попытку.');

        return;
      }
    }

    const { error } = editingContactId
  ? await sb
      .from('patient_contacts')
      .update(payload)
      .eq('id', editingContactId)
      .eq('patient_id', p.id)
      .eq('therapist_id', user.id)
  : await sb
      .from('patient_contacts')
      .insert(payload);
    if (!accountIsCurrent()) return;

    if (error) {
      console.error('Ошибка сохранения контакта:', error);
      contactSaveBtn.disabled = false;
      contactSaveBtn.textContent = 'Сохранить контакт';
      setContactStatus('error', 'Не удалось сохранить контакт. Проверьте данные и попробуйте ещё раз.');

      return;
    }

    setContactStatus('saved', 'Контакт сохранён.');
editingContactId = null;

    await loadPatientData();
    if (!accountIsCurrent()) return;
    if (navigateSection?.refresh) await navigateSection.refresh('overview'); else renderPatient();
  };
}
const findContactById = contactId =>
  (state.contacts || []).find(
    contact => String(contact.id) === String(contactId)
  );

document
  .querySelectorAll('[data-call-contact]')
  .forEach(callBtn => {
    callBtn.onclick = () => {
      const contact =
        findContactById(callBtn.dataset.callContact);

      if (!contact?.phone) return;

      const phone = String(contact.phone)
        .replace(/[^\d+]/g, '');

      window.location.href = `tel:${phone}`;
    };
  });

document
  .querySelectorAll('[data-sms-contact]')
  .forEach(smsBtn => {
    smsBtn.onclick = () => {
      const contact =
        findContactById(smsBtn.dataset.smsContact);

      if (!contact?.phone) return;

      const phone = String(contact.phone)
        .replace(/[^\d+]/g, '');

      window.location.href = `sms:${phone}`;
    };
  });

document
  .querySelectorAll('[data-telegram-contact]')
  .forEach(telegramBtn => {
    telegramBtn.onclick = () => {
      const contact =
        findContactById(
          telegramBtn.dataset.telegramContact
        );

      if (!contact?.telegram) return;

      const username = String(contact.telegram)
        .trim()
        .replace(/^@/, '');

      if (!username) return;

      window.open(
        `https://t.me/${encodeURIComponent(username)}`,
        '_blank',
        'noopener'
      );
    };
  });

document
  .querySelectorAll('[data-edit-contact]')
  .forEach(editBtn => {
    editBtn.onclick = () => {
      const contact =
        findContactById(editBtn.dataset.editContact);

      if (!contact || !contactForm || !contactFormWrap) {
        return;
      }

      editingContactId = contact.id;

      contactForm.elements.full_name.value =
        contact.full_name || '';

      contactForm.elements.relation.value =
        contact.relation || '';

      contactForm.elements.phone.value =
        contact.phone || '';

      contactForm.elements.email.value = contact.email || '';

      contactForm.elements.telegram.value =
        contact.telegram || '';

      contactForm.elements.is_primary.checked =
        Boolean(contact.is_primary);

      const formTitle =
        contactFormWrap.querySelector('h3');

      const contactSaveBtn =
        document.getElementById('contactSaveBtn');

      if (formTitle) {
        formTitle.textContent = 'Изменить контакт';
      }

      if (contactSaveBtn) {
        contactSaveBtn.textContent =
          'Сохранить изменения';
      }

      contactFormWrap.style.display = 'block';

      contactFormWrap.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    };
  });

  document
  .querySelectorAll('[data-delete-contact]')
  .forEach(deleteBtn => {
    deleteBtn.onclick = async () => {
    if (!accountIsCurrent()) return;
      const contact =
        findContactById(deleteBtn.dataset.deleteContact);

      if (!contact) return;

      const confirmed = window.confirm(
        `Удалить контакт «${contact.full_name}»?`
      );

      if (!confirmed) return;

      const oldText = deleteBtn.textContent;

      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Удаляю...';

      const { error } = await sb
        .from('patient_contacts')
        .delete()
        .eq('id', contact.id)
        .eq('patient_id', p.id)
        .eq('therapist_id', user.id);
    if (!accountIsCurrent()) return;

      if (error) {
        console.error('Ошибка удаления контакта:', error);
        deleteBtn.disabled = false;
        deleteBtn.textContent = oldText;

        alert('Не удалось удалить контакт. Попробуйте ещё раз.');

        return;
      }

      await loadPatientData();
    if (!accountIsCurrent()) return;
      if (navigateSection?.refresh) await navigateSection.refresh('overview'); else renderPatient();
    };
  });

  if (state.tab === 'assessment') {
    box.innerHTML = assessmentHtml(state.assessment);

box.insertAdjacentHTML('beforeend', `
  <section class="card document-workspace">
    <div class="workspace-heading document-workspace-heading">
      <div>
        <h3>Документы и исследования</h3>
        <p>Добавляйте обследования, заключения, выписки и другие документы ребёнка.</p>
      </div>
    </div>

    <form id="documentForm" class="document-upload-form">
      <div class="document-field-grid">
        <label>Тип документа
          <select name="document_type" required>
            <option value="">Выберите тип</option>
            <option value="mri_ct">МРТ / КТ</option>
            <option value="xray">Рентген</option>
            <option value="nsg">НСГ</option>
            <option value="eeg">ЭЭГ</option>
            <option value="enmg">ЭНМГ</option>
            <option value="ultrasound">УЗИ</option>
            <option value="doppler">Допплерография</option>
            <option value="doctor_report">Заключение врача</option>
            <option value="discharge">Выписка</option>
            <option value="labs">Анализы</option>
            <option value="genetic">Генетические исследования</option>
            <option value="other">Другое</option>
          </select>
        </label>

        <label>Дата исследования
          <input type="date" name="document_date">
        </label>
      </div>

      <label class="document-file-picker">Файлы
        <input
          id="documentFile"
          type="file"
          accept="image/*,application/pdf"
          multiple
          required
        >
      </label>
      <p class="help document-file-help">Можно выбрать несколько изображений или PDF. Размер одного файла — до 20 МБ.</p>

      <label>Комментарий
        <textarea
          name="document_note"
          placeholder="Например: заключение невролога, контроль после лечения"
        ></textarea>
      </label>

      <button id="documentUploadBtn" class="btn primary document-upload-button" type="submit">
        Добавить документ
      </button>

      <div id="documentStatus" class="save-status document-save-status" aria-live="polite"></div>
    </form>
  </section>

  <section class="card documents-library">
    <div class="workspace-heading documents-library-heading">
      <div>
        <h3>Сохранённые документы</h3>
        <p>Открывайте документ в новой вкладке или удаляйте лишние файлы.</p>
      </div>
    </div>

    <div id="documentList">
      <div class="document-empty-state">
        <strong>Документов пока нет</strong>
        <span>Добавьте первое исследование или заключение выше.</span>
      </div>
    </div>
  </section>
`);

    const form = document.getElementById('assessmentForm'), btn = document.getElementById('assessmentSaveBtn'), status = document.getElementById('assessmentSaveStatus');
    watchFormDirty(form, btn, state.assessment?.id ? 'Сохранить изменения' : 'Сохранить оценку в облако');
    enableAssessmentFloatingSave(
  form,
  btn,
  status
);
    enableAssessmentSectionCollapse(form);
    enableVoiceInput(form);

const documentForm = document.getElementById('documentForm');
const documentFile = document.getElementById('documentFile');
const documentUploadBtn = document.getElementById('documentUploadBtn');
const documentStatus = document.getElementById('documentStatus');
const documentList = document.getElementById('documentList');

const documentEmptyHtml = `
  <div class="document-empty-state">
    <strong>Документов пока нет</strong>
    <span>Добавьте первое исследование или заключение выше.</span>
  </div>
`;

const setDocumentStatus = (message = '', stateName = '') => {
  if (!documentStatus) return;
  documentStatus.textContent = message;
  documentStatus.dataset.state = stateName;
};

const documentTypeLabels = {
  mri_ct: 'МРТ / КТ',
  xray: 'Рентген',
  nsg: 'НСГ',
  eeg: 'ЭЭГ',
  enmg: 'ЭНМГ',
  ultrasound: 'УЗИ',
  doppler: 'Допплерография',
  doctor_report: 'Заключение врача',
  discharge: 'Выписка',
  labs: 'Анализы',
  genetic: 'Генетические исследования',
  doppler: 'Допплерография',
  other: 'Другое'
};

async function loadPatientDocuments() {
    if (!accountIsCurrent()) return;
  documentList.innerHTML =
    '<div class="document-list-loading">Загружаем документы…</div>';

  try {
    const { data, error } = await sb
      .from('patient_media')
      .select(
        'id, storage_path, media_type, document_type, note, captured_at, created_at'
      )
      .eq('patient_id', p.id)
      .eq('media_type', 'document')
      .order('created_at', { ascending: false });
    if (!accountIsCurrent()) return;

    if (error) throw error;

    if (!data || !data.length) {
      documentList.innerHTML = documentEmptyHtml;
      return;
    }

    const items = await Promise.all(
      data.map(async item => {
    if (!accountIsCurrent()) return;
        const { data: signedData, error: signedError } =
          await sb.storage
            .from('patient-media')
            .createSignedUrl(item.storage_path, 3600);
    if (!accountIsCurrent()) return;

        if (signedError) {
          console.error(signedError);
          return null;
        }

        const safeUrl = safeStorageUrl(signedData?.signedUrl);

        if (!safeUrl) {
          console.error('Получен недопустимый URL документа');
          return null;
        }

        return {
          ...item,
          url: safeUrl
        };
      })
    );
    if (!accountIsCurrent()) return;

    const availableItems = items
  .filter(Boolean)
  .sort((a, b) => {
    const dateA = new Date(
      a.captured_at || a.created_at || 0
    ).getTime();

    const dateB = new Date(
      b.captured_at || b.created_at || 0
    ).getTime();

    return dateB - dateA;
  });

    const usedDocumentTypes = [
  ...new Set(
    availableItems.map(item => item.document_type || 'other')
  )
];

    if (!availableItems.length) {
      documentList.innerHTML = documentEmptyHtml;
      return;
    }

documentList.innerHTML = `
  <div class="document-filter-bar" aria-label="Фильтр документов">
    <button
      type="button"
      class="btn document-filter-chip primary"
      data-document-filter="all"
    >
      Все
    </button>

    ${usedDocumentTypes
      .map(type => `
        <button
          type="button"
          class="btn document-filter-chip"
          data-document-filter="${type}"
        >
          ${documentTypeLabels[type] || 'Другое'}
        </button>
      `)
      .join('')}
  </div>

  <div class="document-card-list">
    ${availableItems
      .map(item => {
        const dateValue = item.captured_at || item.created_at;

        const dateText = dateValue
          ? new Date(dateValue).toLocaleDateString('ru-RU')
          : 'Дата не указана';

        

        return `
          <article
            class="document-card"
            data-document-card="${item.id}"
            data-document-type="${item.document_type || 'other'}"
          >
            <div class="document-card-content">
              <span class="document-card-type">Документ</span>
              <h4>${documentTypeLabels[item.document_type] || 'Документ'}</h4>
              <p class="document-card-date">${dateText}</p>
              ${item.note ? `<p class="document-card-note">${esc(item.note)}</p>` : ''}
            </div>
            <div class="document-card-actions">
              <a
                class="btn small"
                href="${esc(item.url)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                Открыть документ
              </a>

              <button
                type="button"
                class="link document-delete-link"
                data-delete-document="${item.id}"
              >
                Удалить
              </button>
            </div>
          </article>`;
      })
      .join('')}
  </div>
`;
documentList
  .querySelectorAll('[data-document-filter]')
  .forEach(filterBtn => {
    filterBtn.onclick = () => {
      const selectedType =
        filterBtn.dataset.documentFilter;

      documentList
        .querySelectorAll('[data-document-filter]')
        .forEach(btn => btn.classList.remove('primary'));

      filterBtn.classList.add('primary');

      documentList
        .querySelectorAll('[data-document-card]')
        .forEach(card => {
          const show =
            selectedType === 'all' ||
            card.dataset.documentType === selectedType;

          card.style.display = show ? '' : 'none';
        });
    };
  });
    documentList
      .querySelectorAll('[data-delete-document]')
      .forEach(btn => {
        btn.onclick = async () => {
    if (!accountIsCurrent()) return;
          const documentId = btn.dataset.deleteDocument;

          const item = availableItems.find(
            x => x.id === documentId
          );

          if (!item) return;

          const confirmed = confirm(
            'Удалить этот документ? Это действие нельзя отменить.'
          );

          if (!confirmed) return;

          btn.disabled = true;
          btn.textContent = 'Удаляю...';

          try {
            const { error: deleteFileError } = await sb.storage
              .from('patient-media')
              .remove([item.storage_path]);
    if (!accountIsCurrent()) return;

            if (deleteFileError) throw deleteFileError;

            const { error: deleteRowError } = await sb
              .from('patient_media')
              .delete()
              .eq('id', item.id);
    if (!accountIsCurrent()) return;

            if (deleteRowError) throw deleteRowError;

            const card = documentList.querySelector(
  `[data-document-card="${item.id}"]`
);

if (card) card.remove();

const remainingCards =
  documentList.querySelectorAll('[data-document-card]');

if (!remainingCards.length) {
  documentList.innerHTML =
    documentEmptyHtml;
  return;
}

const documentType =
  item.document_type || 'other';

const remainingSameType =
  documentList.querySelector(
    `[data-document-card][data-document-type="${documentType}"]`
  );

if (!remainingSameType) {
  const typeButton =
    documentList.querySelector(
      `[data-document-filter="${documentType}"]`
    );

  const wasActive =
    typeButton?.classList.contains('primary');

  if (typeButton) {
    typeButton.remove();
  }

  if (wasActive) {
    const allButton =
      documentList.querySelector(
        '[data-document-filter="all"]'
      );

    if (allButton) {
      allButton.click();
    }
  }
}
          } catch (error) {
    if (!accountIsCurrent()) return;
            console.error(error);

            alert('Не удалось удалить документ. Повторите попытку.');

            btn.disabled = false;
            btn.textContent = 'Удалить';
          }
        };
      });

  } catch (error) {
    if (!accountIsCurrent()) return;
    console.error(error);

    documentList.innerHTML =
      '<div class="error">Не удалось загрузить документы. Проверьте подключение и обновите страницу.</div>';
  }
}

loadPatientDocuments();

documentForm.onsubmit = async e => {
    if (!accountIsCurrent()) return;
  e.preventDefault();

  const files = Array.from(documentFile.files);

  if (!files.length) {
    setDocumentStatus('Выберите хотя бы один файл.', 'error');
    return;
  }

  const allowedTypes = [
    'application/pdf'
  ];

  const invalidFile = files.find(
    file =>
      !file.type.startsWith('image/') &&
      !allowedTypes.includes(file.type)
  );

  if (invalidFile) {
    setDocumentStatus('Можно загружать изображения или PDF.', 'error');
    return;
  }

  const tooLargeFile = files.find(
    file => file.size > 20 * 1024 * 1024
  );

  if (tooLargeFile) {
    setDocumentStatus(`Файл «${tooLargeFile.name}» больше 20 МБ.`, 'error');
    return;
  }

  const fd = new FormData(documentForm);

  const documentType = fd.get('document_type');
  const documentDate = fd.get('document_date');
  const note =
    fd.get('document_note')?.trim() || null;

  documentUploadBtn.disabled = true;
  setDocumentStatus('Готовим загрузку…', 'saving');

  let uploadedCount = 0;

  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      documentUploadBtn.textContent =
        `Загружаем ${i + 1} из ${files.length}…`;

      setDocumentStatus(`Загружаем файл ${i + 1} из ${files.length}…`, 'saving');

      const safeName = file.name
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(-100);

      const storagePath =
        `${user.id}/${p.id}/documents/` +
        `${crypto.randomUUID()}-${safeName}`;

      const { error: uploadError } = await sb.storage
        .from('patient-media')
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        });
    if (!accountIsCurrent()) return;

      if (uploadError) throw uploadError;

      const { error: documentError } = await sb
        .from('patient_media')
        .insert({
          patient_id: p.id,
          therapist_id: user.id,
          storage_path: storagePath,
          media_type: 'document',
          document_type: documentType,
          note: note,
          captured_at: documentDate
            ? `${documentDate}T12:00:00`
            : null
        });
    if (!accountIsCurrent()) return;

      if (documentError) {
        await sb.storage
          .from('patient-media')
          .remove([storagePath]);
    if (!accountIsCurrent()) return;

        throw documentError;
      }

      uploadedCount++;
    }

    setDocumentStatus(`Загружено документов: ${uploadedCount}`, 'saved');

    documentUploadBtn.textContent =
      'Документы добавлены';

    documentForm.reset();

    await loadPatientDocuments();
    if (!accountIsCurrent()) return;

    setTimeout(() => {
      if (!accountIsCurrent()) return;
      documentUploadBtn.textContent =
        'Добавить документ';

      documentUploadBtn.disabled = false;
    }, 1200);

  } catch (error) {
    if (!accountIsCurrent()) return;
    console.error(error);

    setDocumentStatus(
      uploadedCount
        ? `Загружено ${uploadedCount} из ${files.length}. Остальные файлы не добавлены.`
        : 'Не удалось добавить документы. Проверьте подключение и повторите.',
      'error'
    );

    documentUploadBtn.textContent =
      'Добавить документ';

    documentUploadBtn.disabled = false;
  }
};
const standardizedHistoryDate =
  document.getElementById('standardizedHistoryDate');

const saveStandardizedHistoryBtn =
  document.getElementById('saveStandardizedHistoryBtn');

const standardizedHistoryStatus =
  document.getElementById('standardizedHistoryStatus');

const standardizedHistoryList =
  document.getElementById('standardizedHistoryList');

const standardizedScaleLabels = {
  gmfcs: 'GMFCS',
  macs: 'MACS',
  cfcs: 'CFCS',
  edacs: 'EDACS',
  hine: 'HINE',
  gmfm66: 'GMFM-66',
  other: 'Другая шкала'
};

if (standardizedHistoryDate && !standardizedHistoryDate.value) {
  const now = new Date();
  const localDate = new Date(
    now.getTime() - now.getTimezoneOffset() * 60000
  )
    .toISOString()
    .slice(0, 10);

  standardizedHistoryDate.value = localDate;
}

function renderStandardizedLineChart(
  containerId,
  items,
  scale,
  title,
  maxScore
) {
  const container =
    document.getElementById(containerId);

  if (!container) return;

  const points = items
    .filter(
      item =>
        item.scale === scale &&
        item.assessed_at &&
        item.value_numeric !== null &&
        item.value_numeric !== undefined
    )
    .map(item => ({
      date: item.assessed_at,
      value: Number(item.value_numeric)
    }))
    .filter(item => Number.isFinite(item.value))
    .sort((a, b) =>
      a.date.localeCompare(b.date)
    );

  if (points.length < 2) {
    container.innerHTML = `
      <div class="muted">
        Для графика ${title} нужно минимум 2 измерения.
      </div>
    `;
    return;
  }

  const width = 320;
  const height = 150;

  const left = 34;
  const right = 12;
  const top = 18;
  const bottom = 28;

  const plotWidth =
    width - left - right;

  const plotHeight =
    height - top - bottom;

  const xFor = index =>
    points.length === 1
      ? left + plotWidth / 2
      : left +
        (index / (points.length - 1)) *
          plotWidth;

  const values = points.map(point => point.value);

const observedMin = Math.min(...values);
const observedMax = Math.max(...values);

const padding = Math.max(
  2,
  (observedMax - observedMin) * 0.35
);

const chartMin = Math.max(
  0,
  Math.floor(observedMin - padding)
);

const chartMax = Math.min(
  maxScore,
  Math.ceil(observedMax + padding)
);

const chartRange =
  Math.max(1, chartMax - chartMin);

const yFor = value => {
  const safeValue = Math.max(
    chartMin,
    Math.min(chartMax, value)
  );

  return (
    top +
    plotHeight -
    ((safeValue - chartMin) / chartRange) *
      plotHeight
  );
};

  const polyline = points
    .map(
      (point, index) =>
        `${xFor(index)},${yFor(point.value)}`
    )
    .join(' ');

  const dots = points
  .map(
    (point, index) => `
      <circle
        cx="${xFor(index)}"
        cy="${yFor(point.value)}"
        r="4"
        fill="currentColor"
      >
        <title>
          ${new Date(
            `${point.date}T12:00:00`
          ).toLocaleDateString('ru-RU')}
          — ${point.value}
        </title>
      </circle>

      <text
        x="${xFor(index)}"
        y="${yFor(point.value) - 9}"
        text-anchor="middle"
        font-size="10"
        font-weight="600"
        fill="currentColor"
      >
        ${point.value}
      </text>
    `
  )
  .join('');

  const first = points[0];
  const last = points[points.length - 1];

  const firstDate = new Date(
    `${first.date}T12:00:00`
  ).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit'
  });

  const lastDate = new Date(
    `${last.date}T12:00:00`
  ).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit'
  });

  const difference =
    last.value - first.value;

  const differenceText =
    difference > 0
      ? `+${difference.toFixed(1)}`
      : difference.toFixed(1);

  container.innerHTML = `
    <div
      style="
        padding:12px;
        border:1px solid #e5e7eb;
        border-radius:12px;
      "
    >
      <div
        style="
          display:flex;
          justify-content:space-between;
          gap:12px;
          margin-bottom:8px;
        "
      >
        <strong>${title}</strong>

        <span class="muted tiny">
          Изменение: ${differenceText}
        </span>
      </div>

      <svg
        viewBox="0 0 ${width} ${height}"
        style="
          width:100%;
          height:auto;
          display:block;
          overflow:visible;
        "
      >
        <line
          x1="${left}"
          y1="${top}"
          x2="${left}"
          y2="${top + plotHeight}"
          stroke="#d1d5db"
        />

        <line
          x1="${left}"
          y1="${top + plotHeight}"
          x2="${left + plotWidth}"
          y2="${top + plotHeight}"
          stroke="#d1d5db"
        />

        <text
          x="${left - 6}"
          y="${top + 4}"
          text-anchor="end"
          font-size="10"
          fill="#6b7280"
        >
          ${chartMax}
        </text>

        <text
          x="${left - 6}"
          y="${top + plotHeight}"
          text-anchor="end"
          font-size="10"
          fill="#6b7280"
        >
          ${chartMin}
        </text>

        <polyline
          points="${polyline}"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />

        ${dots}

        <text
          x="${left}"
          y="${height - 6}"
          text-anchor="start"
          font-size="10"
          fill="#6b7280"
        >
          ${firstDate}
        </text>

        <text
          x="${left + plotWidth}"
          y="${height - 6}"
          text-anchor="end"
          font-size="10"
          fill="#6b7280"
        >
          ${lastDate}
        </text>
      </svg>

      <div
        class="muted tiny"
        style="margin-top:4px"
      >
        ${points.length} измерений ·
        последнее значение: ${last.value}
      </div>
    </div>
  `;
}

async function loadStandardizedHistory() {
    if (!accountIsCurrent()) return;
  if (!standardizedHistoryList) return;

  standardizedHistoryList.innerHTML =
    '<div class="muted">Загружаю историю оценок...</div>';

  try {
    const { data, error } = await sb
      .from('standardized_assessments')
      .select(
        'id, scale, value_text, value_numeric, assessed_at, note, created_at'
      )
      .eq('patient_id', p.id)
      .order('assessed_at', {
        ascending: false,
        nullsFirst: false
      })
      .order('created_at', {
        ascending: false
      });
    if (!accountIsCurrent()) return;

    if (error) throw error;

    const items = data || [];
renderStandardizedLineChart(
  'gmfm66Chart',
  items,
  'gmfm66',
  'GMFM-66',
  100
);

renderStandardizedLineChart(
  'hineChart',
  items,
  'hine',
  'HINE',
  78
);


    if (!items.length) {
      standardizedHistoryList.innerHTML =
        '<div class="muted">Истории оценок пока нет.</div>';
      return;
    }

    const groups = {};

items.forEach(item => {
  const dateKey =
    item.assessed_at || 'no-date';

  if (!groups[dateKey]) {
    groups[dateKey] = [];
  }

  groups[dateKey].push(item);
});

standardizedHistoryList.innerHTML =
  Object.entries(groups)
    .map(([dateKey, groupItems]) => {
      const dateText =
        dateKey !== 'no-date'
          ? new Date(
              `${dateKey}T12:00:00`
            ).toLocaleDateString('ru-RU')
          : 'Дата не указана';

      return `
        <div
          style="
            margin-top:14px;
            padding-top:12px;
            border-top:1px solid #e5e7eb;
          "
        >
          <div
            style="
              font-weight:700;
              font-size:15px;
              margin-bottom:8px;
            "
          >
            ${dateText}
          </div>

          ${groupItems
            .map(item => {
              const value =
                item.value_numeric !== null &&
                item.value_numeric !== undefined
                  ? item.value_numeric
                  : item.value_text || '—';

              const title =
                item.scale === 'other' && item.note
                  ? item.note
                  : standardizedScaleLabels[item.scale] ||
                    item.scale;

              return `
                <div
                  data-standardized-history-card="${item.id}"
                  style="
                    display:grid;
                    grid-template-columns:minmax(0,1fr) auto;
                    gap:8px;
                    align-items:center;
                    padding:8px 0;
                    border-bottom:1px solid #eef0f2;
                  "
                >
                  <div>
                    <strong>
                      ${esc(title)}
                    </strong>

                    <span style="margin-left:8px">
                      ${esc(value)}
                    </span>
                  </div>

                  <button
                    type="button"
                    class="link"
                    data-delete-standardized-history="${item.id}"
                    style="
                      color:#b42318;
                      margin:0;
                    "
                  >
                    Удалить
                  </button>
                </div>
              `;
            })
            .join('')}
        </div>
      `;
    })
    .join('');

    standardizedHistoryList
      .querySelectorAll(
        '[data-delete-standardized-history]'
      )
      .forEach(btn => {
        btn.onclick = async () => {
    if (!accountIsCurrent()) return;
          const id =
            btn.dataset.deleteStandardizedHistory;

          const confirmed = confirm(
            'Удалить эту запись из истории оценок?'
          );

          if (!confirmed) return;

          btn.disabled = true;
          btn.textContent = 'Удаляю...';

          try {
            const { error } = await sb
              .from('standardized_assessments')
              .delete()
              .eq('id', id);
    if (!accountIsCurrent()) return;

            if (error) throw error;

            await loadStandardizedHistory();
    if (!accountIsCurrent()) return;
          } catch (error) {
    if (!accountIsCurrent()) return;
            console.error(error);

            alert(
              'Не удалось удалить результат: ' +
                error.message
            );

            btn.disabled = false;
            btn.textContent = 'Удалить';
          }
        };
      });

  } catch (error) {
    if (!accountIsCurrent()) return;
    console.error(error);

    standardizedHistoryList.innerHTML =
      `<div class="error">Не удалось загрузить историю: ${esc(error.message)}</div>`;
  }
}

loadStandardizedHistory();

if (saveStandardizedHistoryBtn) {
  saveStandardizedHistoryBtn.onclick = async () => {
    if (!accountIsCurrent()) return;
    const fd = new FormData(form);

    const historyDate =
      standardizedHistoryDate?.value || '';

    if (!historyDate) {
      standardizedHistoryStatus.textContent =
        'Укажите дату оценки.';
      return;
    }

    const rows = [];

    const addLevel = (scale, fieldName) => {
      const value = formValue(fd, fieldName);

      if (!value) return;

      rows.push({
        patient_id: p.id,
        therapist_id: user.id,
        scale,
        value_text: value,
        value_numeric: null,
        assessed_at: historyDate,
        note: null
      });
    };

    addLevel('gmfcs', 'gmfcs');
    addLevel('macs', 'macs');
    addLevel('cfcs', 'cfcs');
    addLevel('edacs', 'edacs');

    const hineText =
      formValue(fd, 'hine_score');

    if (hineText) {
      const hineValue = Number(
        hineText.replace(',', '.')
      );

      if (Number.isNaN(hineValue)) {
        standardizedHistoryStatus.textContent =
          'Проверьте значение HINE.';
        return;
      }

      rows.push({
        patient_id: p.id,
        therapist_id: user.id,
        scale: 'hine',
        value_text: null,
        value_numeric: hineValue,
        assessed_at:
          formValue(fd, 'hine_date') ||
          historyDate,
        note: null
      });
    }

    const gmfmText =
      formValue(fd, 'gmfm66_score');

    if (gmfmText) {
      const gmfmValue = Number(
        gmfmText.replace(',', '.')
      );

      if (Number.isNaN(gmfmValue)) {
        standardizedHistoryStatus.textContent =
          'Проверьте значение GMFM-66.';
        return;
      }

      rows.push({
        patient_id: p.id,
        therapist_id: user.id,
        scale: 'gmfm66',
        value_text: null,
        value_numeric: gmfmValue,
        assessed_at:
          formValue(fd, 'gmfm66_date') ||
          historyDate,
        note: null
      });
    }

    const otherName =
      formValue(fd, 'test_name');

    const otherResult =
      formValue(fd, 'test_result');

    if (otherName || otherResult) {
      rows.push({
        patient_id: p.id,
        therapist_id: user.id,
        scale: 'other',
        value_text: otherResult || 'Результат не указан',
        value_numeric: null,
        assessed_at: historyDate,
        note: otherName || 'Другая шкала'
      });
    }

    if (!rows.length) {
      standardizedHistoryStatus.textContent =
        'Сначала заполните хотя бы одну шкалу или классификацию.';
      return;
    }

    saveStandardizedHistoryBtn.disabled = true;
    saveStandardizedHistoryBtn.textContent =
      '⏳ Сохраняю...';

    standardizedHistoryStatus.textContent = '';

    try {
      const { error } = await sb
        .from('standardized_assessments')
.upsert(rows, {
  onConflict: 'patient_id,scale,assessed_at'
});
    if (!accountIsCurrent()) return;

      if (error) throw error;

      standardizedHistoryStatus.textContent =
        `✓ Добавлено результатов: ${rows.length}`;

      saveStandardizedHistoryBtn.textContent =
        '✓ Результаты добавлены';

      await loadStandardizedHistory();
    if (!accountIsCurrent()) return;

      setTimeout(() => {
      if (!accountIsCurrent()) return;
        saveStandardizedHistoryBtn.disabled = false;
        saveStandardizedHistoryBtn.textContent =
          '+ Добавить текущие результаты';
      }, 1200);

    } catch (error) {
    if (!accountIsCurrent()) return;
      console.error(error);

      standardizedHistoryStatus.textContent =
        'Ошибка: ' + error.message;

      saveStandardizedHistoryBtn.disabled = false;
      saveStandardizedHistoryBtn.textContent =
        '+ Добавить текущие результаты';
    }
  };
}
    form.onsubmit = async e => {
    if (!accountIsCurrent()) return;
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
    if (!accountIsCurrent()) return;
      if (r.error) { setButtonError(btn); status.textContent = ''; return flash('error', r.error.message) }
      state.assessment = r.data; setButtonSaved(btn); status.textContent = '✓ Данные сохранены в облаке';
    };
  }

  if (state.tab === 'goals') {
    const goalCurrent = () => accountIsCurrent() && state.patientId === p.id && box.isConnected;
    const notice = state.goalSaveNotice?.patientId === p.id ? state.goalSaveNotice.text : '';
    box.innerHTML = `<section class="card goals-workspace"><div class="workspace-heading"><div><h3>Активные цели</h3><p>Рабочая цель и её прогресс. Родитель видит только явно опубликованные цели.</p></div></div>${goalsHtml(state.goals.filter(g => g.status === 'active'), true)}</section>
      ${state.goals.some(g => g.status !== 'active') ? `<section class="card goals-achieved"><h3>Завершённые и приостановленные цели</h3>${goalsHtml(state.goals.filter(g => g.status !== 'active'), true)}</section>` : ''}
      <button class="btn goal-form-toggle" type="button" id="goalFormToggle">Добавить цель</button>
      <form class="card goal-form-card" id="goalForm" hidden><div class="form-heading"><h3>Новая цель</h3></div>
      <label>Функциональная цель<textarea name="title" required></textarea></label>
      <label>Исходное состояние<textarea name="baseline"></textarea></label>
      <label>Критерий достижения<input name="criterion"></label>
      <label>Срок<input type="date" name="deadline"></label>
      <label>Прогресс, %<input type="number" name="progress" min="0" max="100" step="1" value="0" required></label>
      <p data-completion-hint class="muted" hidden>Достигнутая цель сохраняет прогресс 100%.</p>
      <label>Дополнение для родителя (необязательно)<textarea name="parent_note"></textarea></label>
      <label class="goal-visibility-control"><input type="checkbox" name="parent_visible">Показывать родителю</label>
      <p class="muted">При включении родитель увидит название, исходное состояние, критерий, срок и прогресс. Проверьте, что формулировки понятны родителю.</p>
      <div class="goal-actions"><button id="goalSaveBtn" class="btn primary" type="submit">Добавить цель</button><button class="btn" id="goalCancelBtn" type="button">Отмена</button></div></form>
      <p id="goalStatus" class="save-status" role="status" aria-live="polite">${esc(notice)}</p>`;
    const form = document.getElementById('goalForm'), btn = document.getElementById('goalSaveBtn'), status = document.getElementById('goalStatus');
    const toggle = document.getElementById('goalFormToggle');
    let editingGoalId = null, editingGoalVersion = null, busy = false, saved = false;
    const draftId = crypto.randomUUID();
    const setGoalFormOpen = open => { form.hidden = !open; toggle.textContent = open ? 'Скрыть форму' : 'Добавить цель'; };
    const resetForm = () => { editingGoalId = null; editingGoalVersion = null; saved = false; form.reset(); form.elements.progress.readOnly = false; form.querySelector('[data-completion-hint]').hidden = true; form.querySelector('h3').textContent = 'Новая цель'; btn.textContent = 'Добавить цель'; setGoalFormOpen(false); };
    toggle.onclick = () => { if (!goalCurrent() || busy || saved) return; if (form.hidden) { resetForm(); setGoalFormOpen(true); } else resetForm(); };
    document.getElementById('goalCancelBtn').onclick = () => { if (goalCurrent() && !busy && !saved) resetForm(); };
    const goalMessage = visible => visible ? 'Цель сохранена и опубликована родителю' : 'Цель сохранена · не опубликована родителю';
    const reloadGoals = async message => {
      state.goalSaveNotice = {patientId: p.id, text: message};
      status.textContent = message;
      try { await loadPatientData(); if (goalCurrent()) { if (typeof navigateSection === 'function' && navigateSection.refresh) await navigateSection.refresh('goals'); else renderPatient(); } }
      catch { if (goalCurrent()) status.textContent = message + '. Не удалось обновить список. Перейдите во вкладку заново.'; }
    };
    document.querySelectorAll('[data-edit-goal]').forEach(editBtn => {
      editBtn.onclick = () => {
        if (!goalCurrent() || busy || saved) return;
        const goal = state.goals.find(g => g.id === editBtn.dataset.editGoal); if (!goal) return;
        editingGoalId = goal.id; editingGoalVersion = goal.updated_at; setGoalFormOpen(true); form.querySelector('h3').textContent = 'Изменить цель';
        for (const name of ['title','baseline','criterion','deadline','parent_note']) form.elements[name].value = goal[name] || '';
        form.elements.progress.value = String(goal.status === 'achieved' ? 100 : goal.progress ?? 0); form.elements.progress.readOnly = goal.status === 'achieved'; form.querySelector('[data-completion-hint]').hidden = goal.status !== 'achieved'; form.elements.parent_visible.checked = goal.parent_visible === true;
        btn.textContent = 'Сохранить изменения'; form.scrollIntoView({behavior:'smooth',block:'start'});
      };
    });
    form.onsubmit = async e => {
      e.preventDefault(); if (!goalCurrent() || busy || saved) return;
      const fd = new FormData(form), visible = form.elements.parent_visible.checked, title = String(fd.get('title') || '').trim();
      const progress = Number(fd.get('progress'));
      if (!title || !Number.isInteger(progress) || progress < 0 || progress > 100) { status.textContent = 'Укажите цель и прогресс от 0 до 100%'; return; }
      if (visible && title.length > 500) { status.textContent = 'Для родителя название должно быть не длиннее 500 символов'; return; }
      const original = state.goals.find(g => g.id === editingGoalId);
      const payload = {patient_id:p.id,title,baseline:String(fd.get('baseline')||'').trim()||null,criterion:String(fd.get('criterion')||'').trim()||null,deadline:fd.get('deadline')||null,progress,status:progress === 100 ? 'achieved' : original?.status || 'active',parent_note:String(fd.get('parent_note')||'').trim()||null,parent_visible:visible};
      busy = true; btn.disabled = true; status.textContent = 'Сохраняем…';
      try {
        const query = editingGoalId ? sb.from('goals').update(payload).eq('id',editingGoalId).eq('patient_id',p.id) : sb.from('goals').insert({...payload,id:draftId});
        if (editingGoalId && editingGoalVersion) query.eq('updated_at',editingGoalVersion);
        const {error} = await query.select('id').single(); if (!goalCurrent()) return;
        if (error) throw error;
        saved = true; await reloadGoals(goalMessage(visible));
      } catch (error) { if (goalCurrent()) {status.textContent = error?.code === 'PGRST116' ? 'Цель уже изменена. Обновите вкладку перед сохранением; данные формы сохранены.' : 'Не удалось сохранить цель. Данные формы сохранены; повторите попытку.';btn.disabled = false;} }
      finally {busy = false;}
    };
    const mutateGoal = async (button, payload, message) => {
      if (!goalCurrent() || busy || saved) return;
      busy = true; button.disabled = true;
      try {
        const id = button.dataset.completeGoal || button.dataset.visibilityGoal;
        const goal = state.goals.find(g => g.id === id);
        const query = sb.from('goals').update(payload).eq('id',id).eq('patient_id',p.id);
        if (goal?.updated_at) query.eq('updated_at',goal.updated_at);
        const {error} = await query.select('id').single();
        if (!goalCurrent()) return; if (error) throw error; await reloadGoals(message);
      } catch {if (goalCurrent()) {button.disabled = false;status.textContent = 'Не удалось изменить цель. Попробуйте ещё раз.';}}
      finally {busy = false;}
    };
    document.querySelectorAll('[data-complete-goal]').forEach(button => button.onclick = () => {
      if (!goalCurrent() || busy || saved) return;
      const goal = state.goals.find(g => g.id === button.dataset.completeGoal); if (!goal) return;
      if (confirm('Завершить цель? Прогресс станет 100%, статус — достигнуто.')) return mutateGoal(button,{status:'achieved',progress:100},goalMessage(goal.parent_visible));
    });
    document.querySelectorAll('[data-visibility-goal]').forEach(button => button.onclick = () => {
      if (!goalCurrent() || busy || saved) return;
      const goal = state.goals.find(g => g.id === button.dataset.visibilityGoal); if (!goal) return;
      if (!goal.parent_visible && !confirm('Показать родителю название, исходное состояние, критерий, срок и прогресс этой цели?')) return;
      return mutateGoal(button,{parent_visible:!goal.parent_visible},goalMessage(!goal.parent_visible));
    });
    document.querySelectorAll('[data-del-goal]').forEach(button => button.onclick = async () => {
      if (!goalCurrent() || busy || saved || !confirm('Удалить цель? Она будет удалена из карточки ребёнка и кабинета родителя.')) return;
      busy = true; button.disabled = true;
      try {
        const goal = state.goals.find(g => g.id === button.dataset.delGoal);
        const query = sb.from('goals').delete().eq('id',button.dataset.delGoal).eq('patient_id',p.id);
        if (goal?.updated_at) query.eq('updated_at',goal.updated_at);
        const {error} = await query.select('id').single();
        if (!goalCurrent()) return; if (error) throw error; await reloadGoals('Цель удалена из карточки и кабинета родителя');
      } catch {if (goalCurrent()) {button.disabled = false;status.textContent = 'Не удалось удалить цель. Попробуйте ещё раз.';}}
      finally {busy = false;}
    });
  }
  if (state.tab === 'sessions') {
    box.innerHTML = `<form class="card session-form-card" id="sessionForm"><div class="form-heading"><div><h3>Новое занятие</h3><p>Зафиксируйте наблюдения, переносимость и функциональные изменения.</p></div></div>
<section id="acceptedSessionPlan" aria-label="План следующего занятия"></section>

<div
  class="session-ai-intake"
  style="margin-bottom:18px"
>
  <div
    class="item-title"
    style="margin-bottom:6px"
  >
    Рассказать о занятии
  </div>

  <div
    class="muted"
    style="margin-bottom:10px"
  >
    Расскажите своими словами, что делали, как ребёнок реагировал и что изменилось.
  </div>

  <textarea
    name="session_transcript"
    id="sessionTranscript"
    placeholder="Надиктуйте или напишите рассказ о занятии..."
  ></textarea>

  <button
    type="button"
    class="btn full"
    id="analyzeSessionBtn"
    style="margin-top:10px"
  >
    Разобрать с ИИ
  </button>

  <div
    id="sessionAiStatus"
    class="muted tiny"
    style="margin-top:8px"
  >
    ИИ ничего не сохранит без вашего подтверждения.
  </div>
</div>

<div
  class="muted tiny session-manual-divider"
  style="text-align:center; margin:4px 0 14px"
>
  или заполните занятие вручную
</div>

<label>Дата</label><input type="date" name="session_date" value="${new Date().toISOString().slice(0, 10)}"><label>Запись занятия</label><textarea name="note" required></textarea><label>Переносимость</label>
    <select name="tolerance">
  <option value="">Не указано</option>
  <option value="good">Хорошая</option>
  <option value="medium">Средняя</option>
  <option value="low">Низкая</option>
  <option value="unclear">Трудно оценить</option>
</select>

<label>Динамика</label>
<select name="dynamics_status">
  <option value="">Не указано</option>
  <option value="improved">Улучшение</option>
  <option value="stable">Без значимых изменений</option>
  <option value="worse">Ухудшение</option>
  <option value="unclear">Трудно оценить</option>
</select>

<label>Изменения функции</label>
<textarea
  name="function_changes"
  placeholder="Например: стал отпускать опору на 3–4 секунды, появились самостоятельные шаги"
></textarea>

<div class="actions"><button id="sessionSaveBtn" class="btn primary full" type="submit">Сохранить занятие</button></div><div id="sessionStatus" class="save-status"></div></form>

<section class="card next-session-card">
  <div class="workspace-heading"><div><h3>Следующее занятие</h3><p>План создаётся только как черновик для проверки специалистом.</p></div></div>

  <div class="muted next-session-description">
    Fizira может подготовить следующий шаг с учётом целей,
    последних занятий и оценки ребёнка.
  </div>

  <button
    type="button"
    class="btn primary full"
    id="prepareNextSessionBtn"
  >
    Подготовить следующее занятие
  </button>

  <div
    id="nextSessionPlanStatus"
    class="muted tiny"
    style="margin-top:10px"
  ></div>

  <div
    id="nextSessionPlan"
    class="next-session-plan"
  ></div>
</section>

<section class="card session-history-card"><div class="workspace-heading"><div><h3>История занятий</h3><p>Последовательность проведённых занятий и изменений функции.</p></div><span class="badge">${state.sessions.length}</span></div>

${state.sessions.map(s => `
  
  <details class="item session-history-entry"><summary class="item-title">${fmtDate(s.session_date)} · ${esc(toleranceLabel(s.tolerance))}</summary>
  
 <div class="item-sub">${esc(s.note || '')}</div>${sessionDynamicsHtml(s)}${plannedSessionHtml(s.planned_session)}

<div
  class="session-history-actions"
>
  <button
    type="button"
    class="link"
    data-parent-session="${s.id}"
  >
    Отчёт для родителя
  </button>
  <button type="button" class="link"
    data-edit-session="${s.id}"
  >
    Изменить
  </button>

  <button
    type="button"
    class="link"
    style="color:#9b3333"
    data-del-session="${s.id}"
  >
    Удалить
  </button>
</div>
</details>`).join('') || `<div class="empty compact-empty">Занятий пока нет.</div>`}</section>`;
    const parentSessionRoot = document.createElement('div');
    parentSessionRoot.dataset.parentSessionEditor = '';
    box.append(parentSessionRoot);
    box.querySelectorAll('[data-parent-session]').forEach(button => {
      button.onclick = (event,reportId) => {
        if (!accountIsCurrent()) return;
        const source = state.sessions.find(row => row.id === button.dataset.parentSession);
        if (!source) return;
        return renderParentSessionReportEditor({ root: parentSessionRoot, sb, user: { id: accountUserId }, patient: p, reportId,
          session: { id: source.id, patient_id: p.id, therapist_id: accountUserId }, storageOrigin: SUPABASE_URL, isCurrent: accountIsCurrent, refresh: refreshParentControls });
      };
    });
    const form = document.getElementById('sessionForm'), btn = document.getElementById('sessionSaveBtn'), status = document.getElementById('sessionStatus'); watchFormDirty(form, btn, 'Сохранить занятие');
const sessionIsCurrent = () => accountIsCurrent() && form.isConnected;
// Finish already-confirmed writes for the captured patient even if the view changes.
const sessionAccountIsCurrent = () => accountRevision === authViewRevision && accountUserId === user?.id && roleGate.canNavigate();



    enableVoiceInput(form);

    const analyzeSessionBtn =
  document.getElementById('analyzeSessionBtn');

const sessionTranscript =
  document.getElementById('sessionTranscript');

const sessionAiStatus =
  document.getElementById('sessionAiStatus');

  const sessionGoalSuggestions =
  document.createElement('div');

sessionGoalSuggestions.id = 'sessionGoalSuggestions';
sessionGoalSuggestions.className = 'session-goal-suggestions';

sessionAiStatus.insertAdjacentElement(
  'afterend',
  sessionGoalSuggestions
);

let pendingGoalUpdates = [];

analyzeSessionBtn.onclick = async () => {
    if (!sessionIsCurrent()) return;
  const transcript = sessionTranscript.value.trim();

  if (!transcript) {
    sessionAiStatus.textContent =
      'Сначала расскажите о занятии.';
    return;
  }

  const draftFields = ['note', 'tolerance', 'dynamics_status', 'function_changes'];
  const before = draftFields.map(name => form.elements[name].value);
  if (before.some(Boolean) && !confirm('ИИ заменит заполненные поля занятия. Продолжить?')) return;

  analyzeSessionBtn.disabled = true;
  analyzeSessionBtn.textContent = 'Анализируем…';
  sessionAiStatus.textContent =
    'Fizira разбирает запись занятия...';

  try {
    const activeGoals = state.goals
      .filter(goal => goal.status === 'active')
      .map(goal => ({
        id: goal.id,
        title: goal.title,
        progress: goal.progress,
        baseline: goal.baseline,
        criterion: goal.criterion
      }));

    const recentSessions = state.sessions
      .slice(0, 3)
      .map(session => ({
        note: session.note,
        dynamics_status: session.dynamics_status,
        function_changes: session.function_changes
      }));

    const result = await analyzeSessionDraft({
      patientId: p.id,
      transcript,
      goals: activeGoals,
      recentSessions
    });
    if (!sessionIsCurrent()) return;

    validateSessionDraft(result);
    if (draftFields.some((name, index) => form.elements[name].value !== before[index]) &&
        !confirm('Пока ИИ работал, поля были изменены. Заменить ваши правки черновиком ИИ?')) {
      sessionAiStatus.textContent = 'Ручные правки сохранены в форме. Черновик ИИ не применён.';
      return;
    }

    form.elements.note.value =
      result.session_note || transcript;

    form.elements.tolerance.value =
      result.tolerance || '';

    form.elements.dynamics_status.value =
      result.dynamics_status || '';

    form.elements.function_changes.value =
      result.function_changes || '';

      pendingGoalUpdates = [];
sessionGoalSuggestions.innerHTML = '';

const goalUpdates =
  Array.isArray(result.goal_updates)
    ? result.goal_updates
    : [];

goalUpdates.forEach(update => {
  const goal = state.goals.find(
    g =>
      g.id === update.goal_id &&
      g.status === 'active'
  );

  if (!goal) return;

  const currentProgress =
    Number(goal.progress ?? 0);

  
const rawSuggestedProgress =
  Number(update.suggested_progress);

const suggestedProgress =
  Math.min(
    90,
    currentProgress + 20,
    rawSuggestedProgress
  );

  if (
  !Number.isFinite(suggestedProgress) ||
  suggestedProgress <= currentProgress
) {
  return;
}

  const card = document.createElement('div');
  card.className = 'session-goal-suggestion';

  card.innerHTML = `
    <div class="item-title">
      ${esc(goal.title)}
    </div>

    <div class="muted" style="margin-top:6px">
      Сейчас: ${currentProgress}% →
      ИИ предлагает: <b>${suggestedProgress}%</b>
    </div>

    ${
      update.reason
        ? `<div class="muted tiny" style="margin-top:6px">
             ${esc(update.reason)}
           </div>`
        : ''
    }

    <div class="actions" style="margin-top:10px">
      <button
        type="button"
        class="btn"
        data-apply-goal
      >
        Применить
      </button>

      <button
        type="button"
        class="btn"
        data-ignore-goal
      >
        Не менять
      </button>
    </div>
  `;

  const applyBtn =
    card.querySelector('[data-apply-goal]');

  const ignoreBtn =
    card.querySelector('[data-ignore-goal]');

  applyBtn.onclick = () => {
    pendingGoalUpdates =
      pendingGoalUpdates.filter(
        item => item.goal_id !== goal.id
      );

    pendingGoalUpdates.push({
      goal_id: goal.id,
      updated_at: goal.updated_at,
      progress: suggestedProgress
    });

    applyBtn.textContent =
      '✓ Будет применено';

    applyBtn.disabled = true;
    ignoreBtn.disabled = false;
  };

  ignoreBtn.onclick = () => {
    pendingGoalUpdates =
      pendingGoalUpdates.filter(
        item => item.goal_id !== goal.id
      );

    ignoreBtn.textContent =
      '✓ Не менять';

    ignoreBtn.disabled = true;
    applyBtn.disabled = false;
    applyBtn.textContent = 'Применить';
  };

  sessionGoalSuggestions.append(card);
});

if (!sessionGoalSuggestions.children.length) {
  sessionGoalSuggestions.innerHTML = `
    <div class="muted tiny">
      ИИ не предлагает менять прогресс активных целей.
    </div>
  `;
}

    sessionAiStatus.textContent =
      '✓ Черновик подготовлен. Проверьте данные перед сохранением.';
  } catch (error) {
    if (!sessionIsCurrent()) return;
    console.error(
      'Ошибка разбора занятия ИИ:',
      error
    );

    sessionAiStatus.textContent =
      `Ошибка ИИ: ${error.message}`;
  } finally {
    analyzeSessionBtn.disabled = false;
    analyzeSessionBtn.textContent =
      'Разобрать с ИИ';
  }
};

const prepareNextSessionBtn = document.getElementById('prepareNextSessionBtn');
const nextSessionPlanStatus = document.getElementById('nextSessionPlanStatus');
const nextSessionPlan = document.getElementById('nextSessionPlan');
const acceptedSessionPlan = document.getElementById('acceptedSessionPlan');
let planDirty = false;
let planSaving = false;
let sessionSaving = false;
let editingSessionId = null;

// The patient JSONB plan is the pending plan; sessions.planned_session is its immutable snapshot.
// Recovered from initial diff; unchanged in subsequent reviewed snapshots.
function planEditor(root, plan, buttonId, buttonText) {
  const field = (key, label, value) => `<label>${esc(label)}<textarea data-plan-field="${key}">${esc(value || '')}</textarea></label>`;
  root.innerHTML = `
    <h4>План следующего занятия</h4>
    <p class="muted tiny">Планируемая работа. Запись проведённого занятия заполняется отдельно.</p>
    ${field('main_task', 'Главная задача', plan.main_task)}
    ${field('start_check.action', 'Проверить в начале', plan.start_check.action)}
    ${plan.work_blocks.map((block, i) => `<div class="item">
      ${field(`work_blocks.${i}.title`, `${i + 1}. Название активности`, block.title)}
      ${field(`work_blocks.${i}.action`, 'Исходное положение и действия специалиста и ребёнка', block.action)}
      ${field(`work_blocks.${i}.why`, 'Цель блока', block.why)}
      ${field(`work_blocks.${i}.progress_if`, 'Критерий выполнения или прогрессии', block.progress_if)}
    </div>`).join('')}
    ${field('what_to_track', 'Что отслеживать — по одному признаку на строку', plan.what_to_track.join('\n'))}
    ${field('session_success_criteria', 'Признаки прогресса — по одному критерию на строку', plan.session_success_criteria.join('\n'))}
    ${field('cautions', 'Учесть', Array.isArray(plan.cautions) ? plan.cautions.join('\n') : '')}
    <button type="button" class="btn primary full" id="${buttonId}">${buttonText}</button>
    <div data-plan-status role="status" aria-live="polite" class="save-status"></div>`;
  const read = () => {
    const edited = structuredClone(plan);
    root.querySelectorAll('[data-plan-field]').forEach(input => {
      const parts = input.dataset.planField.split('.');
      let target = edited;
      for (const part of parts.slice(0, -1)) target = target[part];
      const key = parts.at(-1);
      target[key] = ['what_to_track','session_success_criteria','cautions'].includes(key)
        ? input.value.split('\n').map(v => v.trim()).filter(Boolean) : input.value.trim();
    });
    return validateNextSessionPlan(edited);
  };
  return read;
}



async function persistPlan(plan) {
  validateNextSessionPlan(plan);
  const savedPlan = { ...plan, saved_at: new Date().toISOString() };
  const query = sb.from('patients').update({next_session_plan:savedPlan})
    .eq('id', p.id).eq('therapist_id', accountUserId);
  // Do not overwrite a plan accepted in another tab while this form was open.
  if (p.next_session_plan) query.eq('next_session_plan', JSON.stringify(p.next_session_plan));
  else query.is('next_session_plan', null);
  const {data, error} = await query.select('id').single();
  if (error || !data) throw new Error('Не удалось сохранить план. Возможно, он изменён в другой вкладке. Обновите карточку и повторите.');
  if (!sessionAccountIsCurrent()) return false;
  p.next_session_plan = savedPlan;
  return true;
}

function lockPlanFields(root, locked) {
  root.querySelectorAll('[data-plan-field]').forEach(field => { field.disabled = locked; });
}

function showAcceptedPlan() {
  acceptedSessionPlan.innerHTML = '';
  planDirty = false;
  if (!p.next_session_plan || editingSessionId) return;
  try { validateNextSessionPlan(p.next_session_plan); }
  catch {
    acceptedSessionPlan.innerHTML = '<p role="status">Ранее сохранённый план неполный. Подготовьте новый план ниже. Исходные данные не изменены.</p>';
    return;
  }
  const read = planEditor(acceptedSessionPlan, p.next_session_plan, 'saveAcceptedPlanBtn', 'Сохранить изменения плана');
  const message = acceptedSessionPlan.querySelector('[data-plan-status]');
  const button = document.getElementById('saveAcceptedPlanBtn');
  message.textContent = '✓ План используется для следующего занятия';
  acceptedSessionPlan.oninput = () => { planDirty = true; message.textContent = 'План изменён — сохраните изменения'; };
  button.onclick = async () => {
    if (!sessionIsCurrent() || planSaving || sessionSaving) return;
    planSaving = true; button.disabled = true;
    lockPlanFields(acceptedSessionPlan, true);
    message.textContent = 'Сохраняю изменения плана…';
    try {
      if (await persistPlan(read()) && sessionIsCurrent()) { showAcceptedPlan(); acceptedSessionPlan.querySelector('[data-plan-status]').textContent = '✓ Изменения плана сохранены'; }
    } catch (error) { if (sessionIsCurrent()) message.textContent = error.message; }
    finally { planSaving = false; button.disabled = false; lockPlanFields(acceptedSessionPlan, false); }
  };
}
showAcceptedPlan();

prepareNextSessionBtn.onclick = async () => {
  if (!sessionIsCurrent() || planSaving || sessionSaving) return;
  if (planDirty && !confirm('В плане есть несохранённые правки. Подготовить новый черновик? Текущий план пока останется в форме.')) return;
  prepareNextSessionBtn.disabled = true;
  prepareNextSessionBtn.textContent = 'Готовим план…';
  nextSessionPlanStatus.textContent = 'Fizira анализирует цели и сохранённые занятия…';
  nextSessionPlan.innerHTML = '';
  try {
    const result = validateNextSessionPlan(await prepareNextSessionPlan(p.id));
    if (!sessionIsCurrent()) return;
    const read = planEditor(nextSessionPlan, result, 'useNextSessionPlanBtn', 'Использовать как план занятия');
    nextSessionPlanStatus.textContent = '✓ Черновик плана готов. Проверьте и примите его.';
    const button = document.getElementById('useNextSessionPlanBtn');
    button.onclick = async () => {
      if (!sessionIsCurrent() || planSaving || sessionSaving) return;
      if (editingSessionId) { nextSessionPlanStatus.textContent = 'Завершите редактирование прошлого занятия, затем примите новый план.'; return; }
      if (p.next_session_plan && !confirm('Заменить план следующего занятия новым?')) return;
      planSaving = true; button.disabled = true;
      lockPlanFields(nextSessionPlan, true);
      lockPlanFields(acceptedSessionPlan, true);
      const message = nextSessionPlan.querySelector('[data-plan-status]');
      message.textContent = 'Сохраняю план…';
      try {
        if (!await persistPlan(read()) || !sessionIsCurrent()) return;
        showAcceptedPlan();
        const confirmation = '✓ План добавлен к следующему занятию';
        acceptedSessionPlan.querySelector('[data-plan-status]').textContent = confirmation;
        nextSessionPlanStatus.textContent = confirmation;
        nextSessionPlan.innerHTML = '';
        acceptedSessionPlan.scrollIntoView({behavior:'smooth', block:'start'});
      } catch (error) { if (sessionIsCurrent()) message.textContent = error.message; }
      finally { planSaving = false; button.disabled = false; lockPlanFields(nextSessionPlan, false); lockPlanFields(acceptedSessionPlan, false); }
    };
  } catch (error) { if (sessionIsCurrent()) nextSessionPlanStatus.textContent = error.message; }
  finally { prepareNextSessionBtn.disabled = false; prepareNextSessionBtn.textContent = 'Подготовить следующее занятие'; }
};


document.querySelectorAll('[data-edit-session]').forEach(editBtn => {
  editBtn.onclick = () => {
    if (!sessionIsCurrent() || sessionSaving || planSaving) return;
    const session = state.sessions.find(
      s => s.id === editBtn.dataset.editSession
    );

    if (!session) return;

    editingSessionId = session.id;
    pendingGoalUpdates = [];
    acceptedSessionPlan.innerHTML = plannedSessionHtml(session.planned_session);
    planDirty = false;

    form.querySelector('h3').textContent =
      'Изменить занятие';

    form.elements.session_date.value =
      session.session_date || '';

    form.elements.note.value =
      session.note || '';

    form.elements.tolerance.value =
      session.tolerance || '';

    form.elements.dynamics_status.value =
      session.dynamics_status || '';

    form.elements.function_changes.value =
      session.function_changes || '';

    btn.textContent =
      'Сохранить изменения';

    form.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  };
});

   form.onsubmit = async e => {
  if (!sessionIsCurrent()) return;
  e.preventDefault();
  if (sessionSaving || planSaving) return;
  if (planDirty) { status.textContent = 'Сначала сохраните изменения плана занятия.'; return; }
  sessionSaving = true;
  setButtonSaving(btn);
  let sessionCommitted = false;
  try {
    const fd = new FormData(e.target);
    const goalUpdatesToSave = pendingGoalUpdates.map(update => ({...update}));
    const payload = {
      patient_id: p.id,
      session_date: fd.get('session_date'),
      note: fd.get('note').trim(),
      tolerance: fd.get('tolerance') || null,
      dynamics_status: fd.get('dynamics_status') || null,
      function_changes: fd.get('function_changes').trim() || null
    };
    if (!editingSessionId && p.next_session_plan) {
      payload.planned_session = structuredClone(p.next_session_plan);
    }
    const { error } = editingSessionId
      ? await sb.from('sessions').update(payload).eq('id', editingSessionId).eq('patient_id', p.id)
      : await sb.from('sessions').insert(payload);
    if (!sessionAccountIsCurrent()) return;
    if (error) {
      sessionSaving = false;
      setButtonError(btn, editingSessionId ? 'Сохранить изменения' : 'Сохранить занятие');
      return flash('error', error.message);
    }
    sessionCommitted = true;
    let goalUpdateFailed = false;
    let planCleanupWarning = '';
    for (const update of goalUpdatesToSave) {
      const goalQuery = sb.from('goals').update({progress: update.progress})
        .eq('id', update.goal_id).eq('patient_id', p.id).eq('status', 'active');
      if (update.updated_at) goalQuery.eq('updated_at', update.updated_at);
      const { error: goalError } = await goalQuery.select('id').single();
      if (!sessionAccountIsCurrent()) return;
      if (goalError) {
        console.error('Не удалось обновить прогресс цели:', goalError);
        goalUpdateFailed = true;
        break;
      }
    }
    if (!editingSessionId && p.next_session_plan) {
      const { data: clearedPlanRows, error: clearPlanError } = await sb.from('patients')
        .update({next_session_plan: null}).eq('id', p.id).eq('therapist_id', accountUserId)
        .eq('next_session_plan', JSON.stringify(payload.planned_session)).select('id');
      if (!sessionAccountIsCurrent()) return;
      if (clearPlanError) {
        planCleanupWarning = 'Занятие сохранено, но план не удалось закрыть. Обновите страницу перед следующим занятием.';
        console.error('Занятие сохранено, но план не удалось закрыть:', clearPlanError);
      } else if (!clearedPlanRows || (Array.isArray(clearedPlanRows) && !clearedPlanRows.length)) {
        // Another tab accepted a newer plan: retain it and refresh only this patient's cache.
        const {data: latestPatient, error: refreshError} = await sb.from('patients')
          .select('next_session_plan').eq('id', p.id).eq('therapist_id', accountUserId).single();
        if (!sessionAccountIsCurrent()) return;
        if (!refreshError && latestPatient) p.next_session_plan = latestPatient.next_session_plan;
        else {
          planCleanupWarning = 'Занятие сохранено, но план изменён в другой вкладке и не удалось обновить его. Обновите страницу.';
          console.error('Не удалось обновить план после конфликта:', refreshError);
        }
      } else {
        p.next_session_plan = null;
      }
    }
    if (!sessionIsCurrent()) return;
    setButtonSaved(btn, editingSessionId ? '✓ Изменения сохранены' : '✓ Занятие сохранено');
    status.textContent = planCleanupWarning || (goalUpdateFailed
      ? '⚠️ Занятие сохранено, но прогресс цели обновить не удалось.'
      : '✓ Данные сохранены в облаке');
    if (planCleanupWarning) return;
    await sleep(700);
    if (!sessionIsCurrent()) return;
    await loadPatientData();
    if (!sessionIsCurrent()) return;
    if (typeof navigateSection === 'function' && navigateSection.refresh) await navigateSection.refresh('sessions'); else renderPatient();
  } catch (error) {
    if (!sessionIsCurrent()) return;
    if (sessionCommitted) {
      setButtonSaved(btn, '✓ Занятие сохранено');
      status.textContent = 'Занятие сохранено, но обновление целей или плана не завершено. Обновите страницу; повторно сохранять занятие не нужно.';
    } else {
      setButtonError(btn, editingSessionId ? 'Сохранить изменения' : 'Сохранить занятие');
      status.textContent = 'Не удалось сохранить занятие. Проверьте соединение и повторите; введённые данные остались в форме.';
    }
  } finally {
    if (!sessionCommitted) sessionSaving = false;
  }
};


document.querySelectorAll('[data-del-session]').forEach(deleteBtn => {
  deleteBtn.onclick = async () => {
    if (!sessionIsCurrent()) return;
    const confirmed = confirm(
      'Удалить это занятие? Действие нельзя отменить.'
    );

    if (!confirmed) return;

    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Удаляю...';

    const { error } = await sb
      .from('sessions')
      .delete()
      .eq('id', deleteBtn.dataset.delSession);
    if (!sessionIsCurrent()) return;

    if (error) {
      deleteBtn.disabled = false;
      deleteBtn.textContent = 'Удалить';

      return flash(
        'error',
        error.message
      );
    }

    await loadPatientData();
    if (!sessionIsCurrent()) return;
    if (typeof navigateSection === 'function' && navigateSection.refresh) await navigateSection.refresh('sessions'); else renderPatient();
    
  };
  
});
}

  if (state.tab === 'progress') {
  const sessionsWithDynamics = state.sessions.filter(
    s => s.dynamics_status || s.function_changes
  );

  const improvedCount = sessionsWithDynamics.filter(
    s => s.dynamics_status === 'improved'
  ).length;

  const stableCount = sessionsWithDynamics.filter(
    s => s.dynamics_status === 'stable'
  ).length;

  const worseCount = sessionsWithDynamics.filter(
    s => s.dynamics_status === 'worse'
  ).length;

  const recentChanges = sessionsWithDynamics
    .filter(s => s.function_changes)
    .slice(0, 5);

  box.innerHTML = `
    <section class="card progress-overview-card">
      <div class="workspace-heading"><div><h3>Динамика по занятиям</h3><p>Сводка подтверждённых изменений по записям занятий.</p></div></div>

      <button id="aiDynamicsBtn" class="btn primary full ai-dynamics-action" type="button">
       Анализировать динамику
      </button>

      <div id="aiDynamicsStatus" class="muted tiny ai-dynamics-status"></div>
      <button
  id="aiDynamicsHistoryBtn"
  class="btn ai-dynamics-history"
  type="button"
>
  История анализов
</button>

<div
  id="aiDynamicsHistoryPanel"
  class="card ai-dynamics-history-panel"
  style="display:none"
></div>

      <button
           id="aiDynamicsToggleBtn"
           class="btn ai-result-toggle"
           type="button"
           style="display:none"
      >
           Свернуть анализ
      </button>

       <div id="aiDynamicsResult" class="card ai-result-card ai-dynamics-result" style="display:none"></div>

      ${
        sessionsWithDynamics.length
          ? `
            <div class="metric-grid dynamics-metric-grid">
              <div class="metric">
                <b>${improvedCount}</b>
                <span>улучшений</span>
              </div>

              <div class="metric">
                <b>${stableCount}</b>
                <span>без изменений</span>
              </div>

              <div class="metric">
                <b>${worseCount}</b>
                <span>ухудшений</span>
              </div>

              <div class="metric">
                <b>${sessionsWithDynamics.length}</b>
                <span>оценено занятий</span>
              </div>
            </div>
          `
          : `<div class="empty">Данных о динамике пока нет.</div>`
      }
    </section>

    <section class="card progress-changes-card">
      <div class="workspace-heading"><div><h3>Функциональные изменения</h3><p>Последние наблюдения, записанные специалистом.</p></div></div>

      ${
        recentChanges.length
          ? recentChanges
              .map(
                s => `
                 <details class="item progress-change-entry">
  <summary
    class="item-title"
    style="cursor:pointer"
  >
    ${fmtDate(s.session_date)} · ${esc(dynamicsLabel(s.dynamics_status))}
  </summary>

                    <div>
                      ${esc(s.function_changes)}
                    </div>
                  </details>
                `
              )
              .join('')
          : `<div class="empty">Функциональные изменения пока не зафиксированы.</div>`
      }
    </section>

    <section class="card progress-goals-card">
      <div class="workspace-heading"><div><h3>Динамика по целям</h3><p>Прогресс фиксируется только после подтверждения специалистом.</p></div></div>

      ${
       state.goals.some(g => g.status === 'active')
  ? state.goals
      .filter(g => g.status === 'active')
      .map(
                g => `
                  <div class="goal">
                    <div class="goal-top">
                      <div class="item-title">${esc(g.title)}</div>
                      <div class="goal-pct">${g.progress}%</div>
                    </div>

                    <div class="progress">
                      <span
                        style="width:${Math.max(
                          0,
                          Math.min(100, g.progress)
                        )}%"
                      ></span>
                    </div>

                    <div class="item-sub">
                      ${esc(g.criterion || 'Критерий не указан')}
                      ·
                      ${g.deadline ? fmtDate(g.deadline) : 'срок не указан'}
                    </div>
                  </div>
                `
              )
              .join('')
          : `<div class="empty">Активных целей пока нет.</div>`
      }

${state.goals.some(g => g.status === 'achieved') ? `
  <div class="achieved-goals-list">
    <div class="item-title">Достигнутые цели</div>

    ${goalsHtml(
      state.goals.filter(g => g.status === 'achieved'),
      false
    )}
  </div>
` : ''}

    </section>
  `;

const aiDynamicsBtn = document.getElementById('aiDynamicsBtn');
const aiDynamicsStatus = document.getElementById('aiDynamicsStatus');
const aiDynamicsResult = document.getElementById('aiDynamicsResult');
const aiDynamicsHistoryBtn =
  document.getElementById('aiDynamicsHistoryBtn');

const aiDynamicsHistoryPanel =
  document.getElementById('aiDynamicsHistoryPanel');
const aiDynamicsToggleBtn =
  document.getElementById('aiDynamicsToggleBtn');

if (aiDynamicsToggleBtn && aiDynamicsResult) {
  aiDynamicsToggleBtn.onclick = () => {
    const isOpen = aiDynamicsResult.style.display !== 'none';

    if (isOpen) {
      aiDynamicsResult.style.display = 'none';
      aiDynamicsToggleBtn.textContent = 'Развернуть анализ';
    } else {
      aiDynamicsResult.style.display = 'block';
      aiDynamicsToggleBtn.textContent = 'Свернуть анализ';
    }
  };
}
if (aiDynamicsHistoryBtn && aiDynamicsHistoryPanel && aiDynamicsResult) {
  aiDynamicsHistoryBtn.onclick = async () => {
    if (!accountIsCurrent()) return;
    if (aiDynamicsHistoryPanel.style.display === 'block') {
      aiDynamicsHistoryPanel.style.display = 'none';
      return;
    }

    aiDynamicsHistoryBtn.disabled = true;
    aiDynamicsHistoryBtn.textContent = 'Загружаем…';

    try {
      const history = await loadAiDynamicsHistory(p.id);
    if (!accountIsCurrent()) return;

      aiDynamicsHistoryPanel.innerHTML =
        '<h3>История анализов динамики</h3>';

      if (!history.length) {
        aiDynamicsHistoryPanel.innerHTML +=
          '<div class="muted">Анализов динамики пока нет.</div>';
      } else {
        history.forEach((item, index) => {
          const btn = document.createElement('button');

          btn.className = 'btn full';
          btn.type = 'button';
          btn.style.marginTop = '8px';

          const dateText =
            formatAIAnalysisDate(item.created_at) || 'Дата неизвестна';

          btn.textContent =
            `${index === 0 ? '● ' : ''}${dateText}` +
            `${index === 0 ? ' — последний' : ''}`;

          btn.onclick = () => {
            aiDynamicsResult.innerHTML = formatAIAnalysisBlock(
              item.analysis,
              item.created_at,
              'Архивный анализ динамики ИИ'
            );

            aiDynamicsResult.style.display = 'block';

            if (aiDynamicsToggleBtn) {
              aiDynamicsToggleBtn.style.display = 'block';
              aiDynamicsToggleBtn.textContent = 'Свернуть анализ';
            }
          };

          aiDynamicsHistoryPanel.appendChild(btn);
        });
      }

      aiDynamicsHistoryPanel.style.display = 'block';
    } catch (error) {
    if (!accountIsCurrent()) return;
      console.error(error);

      aiDynamicsHistoryPanel.innerHTML =
        `<div class="error">Не удалось загрузить историю динамики: ${esc(error.message)}</div>`;

      aiDynamicsHistoryPanel.style.display = 'block';
    } finally {
      aiDynamicsHistoryBtn.disabled = false;
      aiDynamicsHistoryBtn.textContent = 'История анализов';
    }
  };
}
if (
  p.ai_dynamics_analysis &&
  aiDynamicsResult &&
  aiDynamicsToggleBtn &&
  aiDynamicsBtn &&
  aiDynamicsStatus
) {
  aiDynamicsResult.innerHTML = formatAIResult(p.ai_dynamics_analysis);
  aiDynamicsResult.style.display = "none";

  aiDynamicsToggleBtn.style.display = 'block';
  aiDynamicsToggleBtn.textContent = "Развернуть анализ";

  aiDynamicsBtn.textContent = "Обновить анализ";

  const savedDynamicsDate =
    formatAIAnalysisDate(p.ai_dynamics_updated_at);

  aiDynamicsStatus.textContent = savedDynamicsDate
    ? `✓ Сохранённый анализ динамики: ${savedDynamicsDate}`
    : "✓ Сохранённый анализ динамики";
}

if (aiDynamicsBtn) {
  aiDynamicsBtn.onclick = async () => {
    if (!accountIsCurrent()) return;
    aiDynamicsBtn.disabled = true;
    aiDynamicsBtn.textContent = 'Анализируем…';

    aiDynamicsStatus.textContent =
      'ИИ сопоставляет занятия, функциональные изменения и цели.';

    try {
      const dynamicsData = {
        age: ageFromDob(p.date_of_birth),
        sex: sexLabel(p.sex),
        primary_complaint: p.primary_complaint || null,

        assessment: state.assessment || null,

        goals: state.goals.map(g => ({
          title: g.title,
          baseline: g.baseline,
          criterion: g.criterion,
          deadline: g.deadline,
          progress: g.progress,
          status: g.status
        })),

        sessions: state.sessions.map(s => ({
          date: s.session_date,
          note: s.note,
          tolerance: toleranceLabel(s.tolerance),
          dynamics: s.dynamics_status
            ? dynamicsLabel(s.dynamics_status)
            : null,
          function_changes: s.function_changes || null
        }))
      };

      const prompt = `
Ты — клинический ассистент специалиста по детской физической терапии.

Проанализируй ДИНАМИКУ ребёнка только на основании предоставленных данных.
Не придумывай навыки, диагнозы, улучшения или ухудшения, которых нет в данных.

ДАННЫЕ:
${JSON.stringify(dynamicsData, null, 2)}

КРИТИЧЕСКИЕ ПРАВИЛА ОЦЕНКИ ДИНАМИКИ:

1. Не называй динамику положительной, стабильной или отрицательной,
если для этого недостаточно повторных сопоставимых наблюдений.

Если нет как минимум двух сопоставимых точек оценки одной и той же функции,
пиши:
"Недостаточно данных для надёжной оценки тенденции".

2. Строго различай:
- подтверждённое отсутствие прогресса;
- прогресс не документирован;
- функция повторно не оценивалась;
- данные противоречивы.

Не подменяй одно другим.

3. Запись о тренировке навыка не является доказательством приобретения навыка.
Например:
"обучались приставным шагам"
НЕ означает
"ребёнок выполняет приставные шаги".

4. Поле function_changes является записью специалиста,
но сама формулировка не всегда доказывает объективное изменение функции.
Сопоставляй её с другими данными.

5. Если ранее навык отмечен как достигнутый, а позже описывается как отсутствующий
или утраченный, не утверждай регресс автоматически.
Пиши:
"возможный регресс, требующий подтверждения"
и объясни противоречие.

6. Если данные противоречат друг другу,
сначала явно укажи противоречие.
Не выбирай одну из версий как достоверную без оснований.

7. Не придумывай диагноз, GMFCS, навыки, степень помощи,
объём движений, силу, тонус или другие показатели,
которых нет в предоставленных данных.

8. Отсутствие записи о функции не означает отсутствие функции.

9. Для каждой важной функции по возможности используй один статус:
- подтверждено улучшение;
- подтверждено ухудшение;
- без подтверждённого изменения;
- повторно не оценивалась;
- данные противоречивы.

10. Если количественных данных мало, прямо укажи это.
Не создавай ложную точность.

Сформируй ответ строго по структуре:

## Краткое клиническое резюме

Укажи отдельными строками:

**Тенденция:** положительная / стабильная / отрицательная / недостаточно данных

**Период анализа:** первая и последняя дата доступных занятий

**Количество занятий:** число представленных занятий

**Занятий с явной оценкой динамики:** число занятий, где dynamics заполнено

**Подтверждённых новых функций:** число только действительно подтверждённых новых функций

**Подтверждённых ухудшений:** число только действительно подтверждённых ухудшений

**Требует уточнения:** одно самое важное противоречие или недостающий показатель

## Подтверждённые функциональные изменения

Перечисли только изменения, которые действительно подтверждаются данными.
Для каждого укажи, на каких записях основан вывод.
Если подтверждённых изменений нет — прямо напиши об этом.

## Функции без доказанной динамики

Раздели их на:
- повторно оценены, но подтверждённого изменения нет;
- повторно не оценивались.

Не называй функцию "без прогресса", если она просто не переоценивалась.

## Динамика целей

Для каждой цели укажи:
- исходный уровень;
- критерий достижения;
- зафиксированный прогресс;
- подтверждается ли прогресс записями занятий;
- статус: достигнута / есть подтверждённый прогресс / прогресс не подтверждён / данных недостаточно.

## Противоречия в данных

Найди клинически значимые несоответствия между:
- первичной оценкой;
- структурированными данными;
- целями;
- записями занятий;
- полем function_changes.

Не разрешай противоречие самостоятельно, если данных недостаточно.

## Что стоит уточнить или измерить

До 5 наиболее важных показателей.
Предпочитай объективные и повторяемые показатели:
время, расстояние, число шагов, число успешных попыток,
уровень помощи, диапазон движения и другие измеримые параметры.

## Практические выводы

До 5 конкретных выводов для дальнейшего ведения.

Не назначай лечение и не делай медицинских заключений,
которые невозможно обосновать представленными данными.

В конце одной строкой:

**Уверенность анализа:** высокая / средняя / низкая — коротко объясни почему.

`;

      const answer = await callAI("dynamics_analysis", p.id);
    if (!accountIsCurrent()) return;
      const aiDynamicsUpdatedAt = new Date().toISOString();

      const { error: saveDynamicsError } = await sb
       .from("patients")
       .update({
         ai_dynamics_analysis: answer,
         ai_dynamics_updated_at: aiDynamicsUpdatedAt
       })
     .eq("id", p.id);
    if (!accountIsCurrent()) return;

    if (saveDynamicsError) {
     throw new Error(
      "Анализ динамики создан, но сохранить его не удалось: " +
      saveDynamicsError.message
  );
}
const { error: dynamicsHistoryError } = await sb
  .from("ai_analysis_history")
  .insert({
    patient_id: p.id,
    therapist_id: user.id,
    analysis: answer,
    patient_snapshot: dynamicsData,
    analysis_type: "dynamics",
    created_at: aiDynamicsUpdatedAt
  });
    if (!accountIsCurrent()) return;

if (dynamicsHistoryError) {
  throw new Error(
    "Анализ динамики сохранён в карточке, но добавить его в историю не удалось: " +
    dynamicsHistoryError.message
  );
}

    p.ai_dynamics_analysis = answer;
    p.ai_dynamics_updated_at = aiDynamicsUpdatedAt;

    aiDynamicsResult.style.display = "block";
    aiDynamicsResult.innerHTML = formatAIResult(answer);

    aiDynamicsToggleBtn.style.display = "block";
    aiDynamicsToggleBtn.textContent = "Свернуть анализ";

    aiDynamicsStatus.textContent = "✓ Анализ динамики готов и сохранён.";
    aiDynamicsBtn.textContent = "Обновить анализ";
    } catch (error) {
    if (!accountIsCurrent()) return;
      console.error(error);

      aiDynamicsStatus.textContent =
        'Не удалось выполнить анализ динамики ИИ. Попробуйте ещё раз.';

      aiDynamicsBtn.textContent = 'Повторить анализ';
    } finally {
      aiDynamicsBtn.disabled = false;
    }
  };
}

}
if (state.tab === 'media') {
  box.innerHTML = `
    <section class="card media-upload-workspace">
      <div class="media-workspace-heading">
        <div>
          <div class="workspace-eyebrow">Клинические материалы</div>
          <h3>Фото и материалы</h3>
          <p>Добавляйте несколько фотографий за один раз, чтобы сравнивать изменения в динамике.</p>
        </div>
      </div>

      <form id="mediaForm" class="media-upload-form">
        <label class="media-file-picker">
          <span>Фотографии</span>
          <input
            id="mediaFile"
            name="media_file"
            type="file"
            accept="image/*"
            multiple
            required
          />
          <small>Можно выбрать несколько изображений. Максимальный размер каждого файла — 20 МБ.</small>
        </label>

        <div class="media-field-grid">
          <label>
            Категория
            <select name="category">
              <option value="other" selected>Другое</option>
              <option value="posture">Поза / осанка</option>
              <option value="sitting">Сидение</option>
              <option value="crawling">Ползание</option>
              <option value="standing">Стояние</option>
              <option value="walking">Ходьба</option>
              <option value="transitions">Переходы</option>
              <option value="lower_limb">Стопы / ноги</option>
              <option value="upper_limb">Руки</option>
              <option value="equipment">ТСР / ортезы</option>
            </select>
          </label>

          <label>
            Дата материала / исследования
            <input
              name="captured_at"
              type="date"
              value="${new Date().toISOString().slice(0, 10)}"
            />
          </label>
        </div>

        <label class="media-note-field">
          Комментарий
          <textarea
            name="note"
            placeholder="Например: стойка у опоры, вид сбоку"
          ></textarea>
        </label>

        <div class="media-upload-actions">
          <button
            id="mediaUploadBtn"
            class="btn primary media-upload-button"
            type="submit"
          >
            + Добавить фото
          </button>
        </div>

        <div id="mediaStatus" class="save-status media-save-status" aria-live="polite"></div>
      </form>
    </section>

    <section class="card media-library">
      <div class="media-library-heading">
        <div>
          <div class="workspace-eyebrow">Галерея пациента</div>
          <h3>Материалы ребёнка</h3>
          <p>Фотографии доступны только в рабочем пространстве специалиста.</p>
        </div>
      </div>
      <div id="mediaList">
        <div class="media-list-loading">Загружаю материалы...</div>
      </div>
    </section>
  `;
const mediaForm = document.getElementById('mediaForm');
const mediaFile = document.getElementById('mediaFile');
const mediaUploadBtn = document.getElementById('mediaUploadBtn');
const mediaStatus = document.getElementById('mediaStatus');
const mediaList = document.getElementById('mediaList');

const setMediaStatus = (status, message) => {
  mediaStatus.textContent = message;
  mediaStatus.dataset.state = status;
};

async function getPatientMediaSignedUrl(storagePath) {
    if (!accountIsCurrent()) return;
  const { data, error } = await sb.storage
    .from('patient-media')
    .createSignedUrl(storagePath, 3600);
    if (!accountIsCurrent()) return;

  if (error) {
    console.error('Не удалось получить временную ссылку на фотографию:', error);
    return '';
  }

  return safeStorageUrl(data?.signedUrl);
}

async function getPatientMediaObjectUrl(storagePath) {
    if (!accountIsCurrent()) return;
  const { data, error } = await sb.storage
    .from('patient-media')
    .download(storagePath);
    if (!accountIsCurrent()) return;

  if (error || !data) {
    console.error('Не удалось загрузить фотографию из приватного хранилища:', error);
    return '';
  }

  return URL.createObjectURL(data);
}

async function loadPatientMedia() {
    if (!accountIsCurrent()) return;
  mediaList.innerHTML =
    '<div class="media-list-loading">Загружаю материалы...</div>';

  try {
    const { data, error } = await sb
      .from('patient_media')
      .select('id, storage_path, media_type, category, note, captured_at, created_at')
      .eq('patient_id', p.id)
      .order('created_at', { ascending: false });
    if (!accountIsCurrent()) return;

    if (error) throw error;

    if (!data || !data.length) {
      mediaList.innerHTML =
        '<div class="media-empty-state"><strong>Фото пока не добавлены</strong><span>Добавьте первые материалы, чтобы видеть динамику ребёнка.</span></div>';
      return;
    }

const items = await Promise.all(
  data.map(async item => {
    if (!accountIsCurrent()) return;
    const safeUrl = await getPatientMediaSignedUrl(item.storage_path);
    if (!accountIsCurrent()) return;

    if (!safeUrl) {
      console.error('Получен недопустимый URL фотографии');
      return null;
    }

    return {
      ...item,
      url: safeUrl
    };
  })
);
    if (!accountIsCurrent()) return;

const availableItems = items
  .filter(Boolean)
  .sort((a, b) => {
    const dateA = new Date(
      a.captured_at || a.created_at || 0
    ).getTime();

    const dateB = new Date(
      b.captured_at || b.created_at || 0
    ).getTime();

    return dateB - dateA;
  });

if (!availableItems.length) {
  mediaList.innerHTML =
    '<div class="media-empty-state"><strong>Материалы недоступны</strong><span>Не удалось открыть сохранённые фотографии. Обновите страницу и попробуйте снова.</span></div>';
  return;
}

const categoryLabels = {
  posture: 'Поза / осанка',
  sitting: 'Сидение',
  crawling: 'Ползание',
  standing: 'Стояние',
  walking: 'Ходьба',
  transitions: 'Переходы',
  lower_limb: 'Стопы / ноги',
  upper_limb: 'Руки',
  equipment: 'ТСР / ортезы',
  other: 'Другое'
};

const usedCategories = [
  ...new Set(
    availableItems.map(item => item.category || 'other')
  )
];

mediaList.innerHTML = `
  <div class="media-filter-bar" role="toolbar" aria-label="Фильтр материалов">
    <button
      type="button"
      class="btn primary media-filter-chip"
      data-media-filter="all"
    >
      Все
    </button>

    ${usedCategories
      .map(category => `
        <button
          type="button"
          class="btn media-filter-chip"
          data-media-filter="${category}"
        >
          ${categoryLabels[category] || 'Другое'}
        </button>
      `)
      .join('')}
  </div>

  <div class="media-gallery-grid">
    ${availableItems
      .map(item => {
        const dateValue = item.captured_at || item.created_at;
        const dateText = dateValue
          ? new Date(dateValue).toLocaleDateString('ru-RU')
          : 'Дата не указана';

        return `
          <article
            class="item media-gallery-card"
            data-media-card="${item.id}"
            data-media-category="${item.category || 'other'}"
          >
            <button
              type="button"
              class="media-preview-button"
              data-media-preview="${esc(item.url)}"
              aria-label="Открыть фотографию за ${dateText}"
            >
              <img
                class="media-gallery-image"
                src="${esc(item.url)}"
                alt="Фото пациента"
              >
            </button>

            <div class="media-gallery-body">
              <div class="media-gallery-meta">
                <span class="media-gallery-date">${dateText}</span>
                <span class="media-category-badge">${categoryLabels[item.category] || 'Другое'}</span>
              </div>

              ${
                item.note
                  ? `<p class="media-gallery-note">${esc(item.note)}</p>`
                  : `<p class="media-gallery-note media-gallery-note-empty">Без комментария</p>`
              }

              <button
                type="button"
                class="link media-delete-action"
                data-delete-media="${item.id}"
              >
                Удалить
              </button>
            </div>
          </article>
        `;
      })
      .join('')}
  </div>
`;

mediaList.querySelectorAll('[data-media-card]').forEach(card => {
  const item = availableItems.find(
    currentItem => currentItem.id === card.dataset.mediaCard
  );
  const image = card.querySelector('.media-gallery-image');
  const previewButton = card.querySelector('[data-media-preview]');

  if (!item || !image || !previewButton) return;

  const showUnavailableState = () => {
    card.classList.add('is-unavailable');
    previewButton.disabled = true;
    previewButton.removeAttribute('data-media-preview');
    previewButton.removeAttribute('data-media-preview-kind');
    previewButton.setAttribute(
      'aria-label',
      'Файл фотографии временно недоступен'
    );

    const unavailableState = document.createElement('span');
    unavailableState.className = 'media-unavailable-state';
    unavailableState.setAttribute('role', 'status');
    unavailableState.textContent = 'Файл недоступен';

    // Replacing the image removes the browser's broken-image icon entirely.
    previewButton.replaceChildren(unavailableState);
  };

  image.onerror = async () => {
    if (!accountIsCurrent()) return;
    const recoveryStep = image.dataset.mediaRecoveryStep || 'refresh';

    if (recoveryStep === 'refresh') {
      image.dataset.mediaRecoveryStep = 'blob';

      const refreshedUrl = await getPatientMediaSignedUrl(item.storage_path);
    if (!accountIsCurrent()) return;

      if (refreshedUrl) {
        previewButton.dataset.mediaPreview = refreshedUrl;
        delete previewButton.dataset.mediaPreviewKind;
        image.src = refreshedUrl;
        return;
      }
    }

    if (image.dataset.mediaRecoveryStep === 'blob') {
      image.dataset.mediaRecoveryStep = 'finished';

      const objectUrl = await getPatientMediaObjectUrl(item.storage_path);
    if (!accountIsCurrent()) return;

      if (objectUrl) {
        previewButton.dataset.mediaPreview = objectUrl;
        previewButton.dataset.mediaPreviewKind = 'blob';
        image.src = objectUrl;
        return;
      }
    }

    showUnavailableState();
  };
});

mediaList.querySelectorAll('[data-media-filter]').forEach(filterBtn => {
  filterBtn.onclick = () => {
    const selectedCategory = filterBtn.dataset.mediaFilter;

    mediaList
      .querySelectorAll('[data-media-filter]')
      .forEach(btn => btn.classList.remove('primary'));

    filterBtn.classList.add('primary');

    mediaList
      .querySelectorAll('[data-media-card]')
      .forEach(card => {
        const show =
          selectedCategory === 'all' ||
          card.dataset.mediaCategory === selectedCategory;

        card.style.display = show ? '' : 'none';
      });
  };
});

mediaList.querySelectorAll('[data-media-preview]').forEach(previewBtn => {
  previewBtn.onclick = () => {
    if (!accountIsCurrent() || !previewBtn.isConnected) return;
    const previewSource = previewBtn.dataset.mediaPreview;
    const previewUrl =
      previewBtn.dataset.mediaPreviewKind === 'blob' &&
      previewSource?.startsWith('blob:')
        ? previewSource
        : safeStorageUrl(previewSource);

    if (!previewUrl) return;

    const mediaCard = previewBtn.closest('[data-media-card]');
    const mediaItem = availableItems.find(
      item => item.id === mediaCard?.dataset.mediaCard
    );
    const overlay = document.createElement('div');
    overlay.className = 'media-preview-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Просмотр фотографии');

    overlay.innerHTML = `
      <div class="media-preview-dialog">
        <img
          src="${esc(previewUrl)}"
          alt="Фото пациента"
        >
        <button
          type="button"
          class="media-preview-close"
          aria-label="Закрыть"
        >
          ×
        </button>
      </div>
    `;

    const closePreview = () => overlay.remove();

    const closeButton = overlay.querySelector('.media-preview-close');
    const previewImage = overlay.querySelector('img');

    previewImage.onerror = async () => {
    if (!accountIsCurrent()) return;
      if (!mediaItem || previewImage.dataset.mediaRecoveryAttempted) return;

      previewImage.dataset.mediaRecoveryAttempted = '1';

      const objectUrl = await getPatientMediaObjectUrl(
        mediaItem.storage_path
      );
    if (!accountIsCurrent()) return;

      if (!objectUrl) return;

      previewBtn.dataset.mediaPreview = objectUrl;
      previewBtn.dataset.mediaPreviewKind = 'blob';
      previewImage.src = objectUrl;
    };

    closeButton.onclick = closePreview;

    overlay.onclick = e => {
      if (e.target === overlay) {
        closePreview();
      }
    };

    overlay.onkeydown = e => {
      if (e.key === 'Escape') {
        closePreview();
      }
    };

    document.body.appendChild(overlay);
    closeButton.focus();
  };
});

      mediaList.querySelectorAll('[data-delete-media]').forEach(btn => {
  btn.onclick = async () => {
    if (!accountIsCurrent()) return;
    const mediaId = btn.dataset.deleteMedia;
    const item = availableItems.find(x => x.id === mediaId);

    if (!item) return;

    const confirmed = confirm(
      'Удалить это фото? Это действие нельзя отменить.'
    );

    if (!confirmed) return;

    btn.disabled = true;
    btn.textContent = 'Удаляю...';

    try {
      // Сначала убираем запись из карточки ребёнка
      const { error: deleteRowError } = await sb
        .from('patient_media')
        .delete()
        .eq('id', item.id);
    if (!accountIsCurrent()) return;

      if (deleteRowError) throw deleteRowError;

      // Затем удаляем сам файл из приватного Storage
      const { error: deleteFileError } = await sb.storage
        .from('patient-media')
        .remove([item.storage_path]);
    if (!accountIsCurrent()) return;

      if (deleteFileError) {
        console.error(
          'Фото удалено из карточки, но файл не удалось удалить:',
          deleteFileError
        );
      }

      const card = mediaList.querySelector(
  `[data-media-card="${item.id}"]`
);

if (card) {
  card.remove();
}

if (!mediaList.querySelector('[data-media-card]')) {
  mediaList.innerHTML =
    '<div class="media-empty-state"><strong>Фото пока не добавлены</strong><span>Добавьте первые материалы, чтобы видеть динамику ребёнка.</span></div>';
}

    } catch (error) {
    if (!accountIsCurrent()) return;
      console.error(error);

      alert('Не удалось удалить фото. Повторите попытку.');

      btn.disabled = false;
      btn.textContent = 'Удалить';
    }
  };
});

  } catch (error) {
    if (!accountIsCurrent()) return;
    console.error(error);

    mediaList.innerHTML =
      '<div class="media-empty-state"><strong>Не удалось загрузить материалы</strong><span>Обновите страницу и попробуйте снова.</span></div>';
  }
}

loadPatientMedia();

mediaForm.onsubmit = async e => {
    if (!accountIsCurrent()) return;
  e.preventDefault();

  const files = Array.from(mediaFile.files);

  if (!files.length) {
    setMediaStatus('error', 'Выберите хотя бы одну фотографию.');
    return;
  }

  const invalidFile = files.find(
    file => !file.type.startsWith('image/')
  );

  if (invalidFile) {
    setMediaStatus('error', 'Сейчас можно загружать только изображения.');
    return;
  }

  const tooLargeFile = files.find(
    file => file.size > 20 * 1024 * 1024
  );

  if (tooLargeFile) {
    setMediaStatus('error', `Файл "${tooLargeFile.name}" больше 20 МБ.`);
    return;
  }

  mediaUploadBtn.disabled = true;
  setMediaStatus('saving', `Подготавливаем к загрузке: ${files.length} фото.`);

  const fd = new FormData(mediaForm);
  const capturedDate = fd.get('captured_at');
  const note = fd.get('note')?.trim() || null;
  const category = fd.get('category') || 'other';

  let uploadedCount = 0;

  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      mediaUploadBtn.textContent =
        `⏳ Загружаю ${i + 1} из ${files.length}...`;
      setMediaStatus(
        'saving',
        `Загружаем фотографию ${i + 1} из ${files.length}.`
      );

      const safeName = file.name
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(-100);

      const storagePath =
        `${user.id}/${p.id}/${crypto.randomUUID()}-${safeName}`;

      const { error: uploadError } = await sb.storage
        .from('patient-media')
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        });
    if (!accountIsCurrent()) return;

      if (uploadError) throw uploadError;

      const { error: mediaError } = await sb
        .from('patient_media')
        .insert({
          patient_id: p.id,
          therapist_id: user.id,
          storage_path: storagePath,
          media_type: 'photo',
          category: category,
          note: note,
          captured_at: capturedDate
            ? `${capturedDate}T12:00:00`
            : null
        });
    if (!accountIsCurrent()) return;

      if (mediaError) {
        await sb.storage
          .from('patient-media')
          .remove([storagePath]);
    if (!accountIsCurrent()) return;

        throw mediaError;
      }

      uploadedCount++;
    }

    setMediaStatus('saved', `Загружено фотографий: ${uploadedCount}.`);

    mediaUploadBtn.textContent =
      '✓ Фотографии добавлены';

    mediaForm.reset();

    setTimeout(() => {
      if (!accountIsCurrent()) return;
      if (navigateSection?.refresh) navigateSection.refresh('media');
      else { state.tab = 'media'; renderPatient(); }
    }, 900);

  } catch (error) {
    if (!accountIsCurrent()) return;
    console.error(error);

    setMediaStatus(
      'error',
      `Загружено ${uploadedCount} из ${files.length}. Не удалось завершить загрузку. Повторите попытку.`
    );

    mediaUploadBtn.textContent = '+ Добавить фото';
    mediaUploadBtn.disabled = false;
  }
};
}

}

init().catch(err => { app.innerHTML = `<div class="error">Ошибка запуска приложения: ${esc(err.message)}</div>` });
