
const STORAGE_KEY = "ptchild_mvp_v04";

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function seedData() {
  return {
    patients: [
      {
        id: uid(),
        firstName: "Ян",
        age: "11 месяцев",
        sex: "Мальчик",
        complaint: "Стойка у опоры преимущественно на переднем отделе стоп.",
        createdAt: new Date().toISOString(),
        goals: [
          {
            id: uid(),
            title: "Стоять у опоры с полной опорой стоп в 4 из 5 наблюдаемых попыток",
            criterion: "4 из 5 попыток",
            deadline: "3 недели",
            progress: 40
          }
        ],
        sessions: [
          {
            id: uid(),
            date: new Date().toISOString().slice(0,10),
            note: "Переходы в стойку у опоры, перенос веса, контроль положения стоп.",
            tolerance: "Хорошая"
          }
        ],
        assessment: {
          complaint: "Мама отмечает стойку у опоры на носках и редкое самостоятельное опускание пяток.",
          pregnancy: "",
          birth: "",
          development: "",
          observation: "",
          neuro: "",
          conclusion: ""
        }
      }
    ]
  };
}

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const data = seedData();
    saveData(data);
    return data;
  }
  try { return JSON.parse(raw); }
  catch {
    const data = seedData();
    saveData(data);
    return data;
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

let data = loadData();
let state = { view: "patients", patientId: data.patients[0]?.id || null, tab: "overview" };

const app = document.getElementById("app");
document.getElementById("homeBtn").addEventListener("click", () => {
  state = { view: "patients", patientId: null, tab: "overview" };
  render();
});

function esc(value="") {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function fmtDate(dateStr) {
  if (!dateStr) return "дата не указана";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("ru-RU", {day:"numeric", month:"long", year:"numeric"});
}

function currentPatient() {
  return data.patients.find(p => p.id === state.patientId);
}

function render() {
  if (state.view === "patients") renderPatients();
  else if (state.view === "newPatient") renderNewPatient();
  else if (state.view === "patient") renderPatient();
}

function renderPatients() {
  app.innerHTML = `
    <div class="topline">
      <div>
        <h2 style="margin-bottom:2px">Пациенты</h2>
        <div class="muted small">${data.patients.length} в демо-базе</div>
      </div>
      <button class="btn primary small-btn" id="addPatientBtn">＋ Ребёнок</button>
    </div>

    <div class="patient-list">
      ${data.patients.map(p => `
        <button class="patient-card" data-patient-id="${p.id}">
          <div class="patient-top">
            <div>
              <div class="patient-name">${esc(p.firstName)}</div>
              <div class="patient-meta">${esc(p.age || "Возраст не указан")} · ${esc(p.sex || "Пол не указан")}</div>
            </div>
            <span class="badge">активное ведение</span>
          </div>
          <div class="item-sub" style="margin-top:9px">${esc(p.complaint || "Причина обращения пока не заполнена")}</div>
          <div class="metric-grid">
            <div class="metric"><b>${p.goals?.length || 0}</b><span>целей</span></div>
            <div class="metric"><b>${p.sessions?.length || 0}</b><span>занятий</span></div>
          </div>
        </button>
      `).join("") || `<div class="card empty">Пока нет пациентов. Создайте первого тестового ребёнка.</div>`}
    </div>
  `;

  document.getElementById("addPatientBtn").onclick = () => {
    state.view = "newPatient";
    render();
  };

  document.querySelectorAll("[data-patient-id]").forEach(el => {
    el.onclick = () => {
      state.view = "patient";
      state.patientId = el.dataset.patientId;
      state.tab = "overview";
      render();
    };
  });
}

function renderNewPatient() {
  app.innerHTML = `
    <div class="topline">
      <h2 style="margin:0">Новый ребёнок</h2>
      <button class="link-btn" id="cancelNew">Отмена</button>
    </div>
    <form class="card" id="newPatientForm">
      <label>Имя / псевдоним для демо</label>
      <input name="firstName" required placeholder="Например: Ян" />

      <div class="row">
        <div>
          <label>Возраст</label>
          <input name="age" placeholder="11 месяцев" />
        </div>
        <div>
          <label>Пол</label>
          <select name="sex">
            <option>Не указано</option>
            <option>Мальчик</option>
            <option>Девочка</option>
          </select>
        </div>
      </div>

      <label>Основная причина обращения</label>
      <textarea name="complaint" placeholder="Краткая жалоба родителя"></textarea>

      <div class="actions">
        <button class="btn primary full" type="submit">Создать карточку</button>
      </div>
    </form>
  `;
  document.getElementById("cancelNew").onclick = () => {
    state.view = "patients"; render();
  };
  document.getElementById("newPatientForm").onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const patient = {
      id: uid(),
      firstName: fd.get("firstName").trim(),
      age: fd.get("age").trim(),
      sex: fd.get("sex"),
      complaint: fd.get("complaint").trim(),
      createdAt: new Date().toISOString(),
      goals: [],
      sessions: [],
      assessment: {complaint:"",pregnancy:"",birth:"",development:"",observation:"",neuro:"",conclusion:""}
    };
    data.patients.unshift(patient);
    saveData(data);
    state = {view:"patient", patientId:patient.id, tab:"overview"};
    render();
  };
}

function renderPatient() {
  const p = currentPatient();
  if (!p) {
    state.view = "patients"; render(); return;
  }

  const tabs = [
    ["overview","Обзор"],["assessment","Оценка"],["goals","Цели"],
    ["sessions","Занятия"],["progress","Динамика"]
  ];

  app.innerHTML = `
    <div class="card">
      <div class="patient-top">
        <div>
          <div class="muted small">Карточка ребёнка</div>
          <h1>${esc(p.firstName)}</h1>
          <div class="patient-meta">${esc(p.age || "Возраст не указан")} · ${esc(p.sex || "Пол не указан")}</div>
        </div>
        <span class="badge">активное ведение</span>
      </div>
      <div class="sep"></div>
      <div class="item-title">${esc(p.complaint || "Причина обращения пока не заполнена")}</div>
    </div>

    <div class="tabs">
      ${tabs.map(([key,label]) => `<button class="tab ${state.tab===key?"active":""}" data-tab="${key}">${label}</button>`).join("")}
    </div>

    <div id="tabContent"></div>
  `;

  document.querySelectorAll("[data-tab]").forEach(btn => {
    btn.onclick = () => { state.tab = btn.dataset.tab; renderPatient(); };
  });

  renderTab(p);
}

function renderTab(p) {
  const box = document.getElementById("tabContent");
  if (state.tab === "overview") {
    box.innerHTML = `
      <div class="card">
        <h3>Сводка</h3>
        <div class="metric-grid">
          <div class="metric"><b>${p.goals.length}</b><span>активных целей</span></div>
          <div class="metric"><b>${p.sessions.length}</b><span>записей занятий</span></div>
        </div>
        <div class="actions">
          <button class="btn primary" id="quickSession">＋ Занятие</button>
          <button class="btn" id="quickGoal">＋ Цель</button>
        </div>
      </div>

      <div class="card">
        <h3>Последнее занятие</h3>
        ${p.sessions.length ? `
          <div class="item-title">${fmtDate(p.sessions[p.sessions.length-1].date)}</div>
          <div class="item-sub">${esc(p.sessions[p.sessions.length-1].note)}</div>
        ` : `<div class="empty">Занятий пока нет.</div>`}
      </div>

      <div class="card">
        <h3>Текущие цели</h3>
        ${goalListHtml(p.goals)}
      </div>

      <div class="danger-zone">
        <button class="btn danger" id="deletePatient">Удалить тестовую карточку</button>
      </div>
    `;
    document.getElementById("quickSession").onclick = () => { state.tab="sessions"; renderPatient(); };
    document.getElementById("quickGoal").onclick = () => { state.tab="goals"; renderPatient(); };
    document.getElementById("deletePatient").onclick = () => {
      if (confirm("Удалить эту тестовую карточку и все её локальные данные?")) {
        data.patients = data.patients.filter(x => x.id !== p.id);
        saveData(data);
        state = {view:"patients",patientId:null,tab:"overview"};
        render();
      }
    };
  }

  if (state.tab === "assessment") {
    const a = p.assessment || {};
    box.innerHTML = `
      <form class="card" id="assessmentForm">
        <h3>Первичная оценка</h3>

        <label>Жалоба</label>
        <textarea name="complaint">${esc(a.complaint || "")}</textarea>

        <label>Беременность / анамнез</label>
        <textarea name="pregnancy" placeholder="Как проходила беременность...">${esc(a.pregnancy || "")}</textarea>

        <label>Роды / ранний период</label>
        <textarea name="birth" placeholder="Срок, способ родоразрешения, осложнения...">${esc(a.birth || "")}</textarea>

        <label>Моторное развитие</label>
        <textarea name="development" placeholder="Контроль головы, перевороты, сидение, ползание...">${esc(a.development || "")}</textarea>

        <label>Осмотр / спонтанная моторика</label>
        <textarea name="observation" placeholder="Переходы, симметрия, положение тела, стопы...">${esc(a.observation || "")}</textarea>

        <label>Неврологические наблюдения</label>
        <textarea name="neuro" placeholder="Тонус, рефлексы, подошвенный ответ, клонус...">${esc(a.neuro || "")}</textarea>

        <label>Физиотерапевтическое заключение</label>
        <textarea name="conclusion" placeholder="Подтверждается специалистом">${esc(a.conclusion || "")}</textarea>

        <div class="actions">
          <button class="btn primary full" type="submit">Сохранить оценку</button>
        </div>
      </form>
      <div class="note">
        В следующей версии вернём детализированные поля и быстрые кнопки из v0.2, но уже с реальным сохранением.
      </div>
    `;
    document.getElementById("assessmentForm").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      p.assessment = Object.fromEntries(fd.entries());
      saveData(data);
      alert("Оценка сохранена на этом устройстве.");
    };
  }

  if (state.tab === "goals") {
    box.innerHTML = `
      <div class="card">
        <h3>Активные цели</h3>
        ${goalListHtml(p.goals)}
      </div>

      <form class="card" id="goalForm">
        <h3>＋ Новая цель</h3>
        <label>Функциональная цель</label>
        <textarea name="title" required placeholder="Что ребёнок должен уметь делать"></textarea>
        <div class="row">
          <div><label>Критерий</label><input name="criterion" placeholder="4 из 5 попыток" /></div>
          <div><label>Срок</label><input name="deadline" placeholder="6 недель" /></div>
        </div>
        <label>Текущий прогресс</label>
        <select name="progress">
          <option value="0">0%</option>
          <option value="20">20%</option>
          <option value="40">40%</option>
          <option value="60">60%</option>
          <option value="80">80%</option>
          <option value="100">100%</option>
        </select>
        <div class="actions"><button class="btn primary full" type="submit">Добавить цель</button></div>
      </form>
    `;
    document.getElementById("goalForm").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      p.goals.push({
        id:uid(),
        title:fd.get("title").trim(),
        criterion:fd.get("criterion").trim(),
        deadline:fd.get("deadline").trim(),
        progress:Number(fd.get("progress"))
      });
      saveData(data);
      renderPatient();
    };
    bindGoalDeletes(p);
  }

  if (state.tab === "sessions") {
    box.innerHTML = `
      <form class="card" id="sessionForm">
        <h3>＋ Новое занятие</h3>
        <label>Дата</label>
        <input type="date" name="date" value="${new Date().toISOString().slice(0,10)}" />
        <label>Запись занятия</label>
        <textarea name="note" required placeholder="Что делали, реакция ребёнка, что получилось..."></textarea>
        <label>Переносимость</label>
        <select name="tolerance">
          <option>Хорошая</option>
          <option>Средняя</option>
          <option>Низкая</option>
          <option>Трудно оценить</option>
        </select>
        <div class="actions"><button class="btn primary full" type="submit">Сохранить занятие</button></div>
      </form>

      <div class="card">
        <h3>История занятий</h3>
        ${p.sessions.slice().reverse().map(s => `
          <div class="item">
            <div class="item-title">${fmtDate(s.date)} · ${esc(s.tolerance)}</div>
            <div class="item-sub">${esc(s.note)}</div>
            <button class="link-btn" data-del-session="${s.id}" style="margin-top:7px;color:#9b3333">Удалить</button>
          </div>
        `).join("") || `<div class="empty">Занятий пока нет.</div>`}
      </div>
    `;
    document.getElementById("sessionForm").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      p.sessions.push({
        id:uid(),
        date:fd.get("date"),
        note:fd.get("note").trim(),
        tolerance:fd.get("tolerance")
      });
      saveData(data);
      renderPatient();
    };
    document.querySelectorAll("[data-del-session]").forEach(btn => {
      btn.onclick = () => {
        p.sessions = p.sessions.filter(s => s.id !== btn.dataset.delSession);
        saveData(data); renderPatient();
      };
    });
  }

  if (state.tab === "progress") {
    box.innerHTML = `
      <div class="card">
        <h3>Динамика по целям</h3>
        ${p.goals.length ? p.goals.map(g => `
          <div class="goal-box">
            <div class="goal-top">
              <div class="item-title">${esc(g.title)}</div>
              <div class="goal-pct">${g.progress}%</div>
            </div>
            <div class="progress"><span style="width:${Math.max(0,Math.min(100,g.progress))}%"></span></div>
            <div class="item-sub">${esc(g.criterion || "Критерий не указан")} · ${esc(g.deadline || "Срок не указан")}</div>
          </div>
        `).join("") : `<div class="empty">Добавьте хотя бы одну цель, чтобы видеть динамику.</div>`}
      </div>

      <div class="card">
        <h3>Активность</h3>
        <div class="metric-grid">
          <div class="metric"><b>${p.sessions.length}</b><span>всего занятий</span></div>
          <div class="metric"><b>${p.goals.filter(g=>g.progress>=100).length}</b><span>достигнутых целей</span></div>
        </div>
      </div>

      <div class="note">
        Следующий этап: повторные измерения, сопоставимые ROM-показатели, результаты стандартизированных тестов и графики изменения во времени.
      </div>
    `;
  }
}

function goalListHtml(goals) {
  if (!goals.length) return `<div class="empty">Целей пока нет.</div>`;
  return goals.map(g => `
    <div class="goal-box">
      <div class="goal-top">
        <div class="item-title">${esc(g.title)}</div>
        <div class="goal-pct">${g.progress}%</div>
      </div>
      <div class="progress"><span style="width:${Math.max(0,Math.min(100,g.progress))}%"></span></div>
      <div class="item-sub">${esc(g.criterion || "Критерий не указан")} · ${esc(g.deadline || "Срок не указан")}</div>
      ${state.tab==="goals" ? `<button class="link-btn" data-del-goal="${g.id}" style="margin-top:7px;color:#9b3333">Удалить цель</button>` : ""}
    </div>
  `).join("");
}

function bindGoalDeletes(p) {
  document.querySelectorAll("[data-del-goal]").forEach(btn => {
    btn.onclick = () => {
      p.goals = p.goals.filter(g => g.id !== btn.dataset.delGoal);
      saveData(data); renderPatient();
    };
  });
}

render();
