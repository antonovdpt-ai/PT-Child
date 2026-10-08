import {escapeHtml as esc} from './security-utils.mjs';

export const patientSections = [
  ['overview','Обзор'], ['assessment','Оценка'], ['goals','Цели'],
  ['sessions','Занятия'], ['progress','Динамика'], ['media','Медиа'], ['parent','Кабинет родителя']
];
const paths = {
  overview:'<rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 4V2h6v2M9 10h6M9 15h6"/>',
  assessment:'<rect x="4" y="14" width="3" height="7" rx="1"/><rect x="10" y="9" width="3" height="12" rx="1"/><rect x="16" y="3" width="3" height="18" rx="1"/>',
  goals:'<circle cx="11" cy="13" r="8"/><circle cx="11" cy="13" r="4"/><path d="m11 13 9-9M16 4h4v4"/>',
  sessions:'<path d="M7 12h10M3 8v8M7 5v14M17 5v14M21 8v8"/>',
  progress:'<path d="m3 18 6-6 4 3 8-10M15 5h6v6"/>',
  media:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m4 18 6-6 4 3 3-4 4 5"/>',
  parent:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3zM16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v2h-3"/>',
  child:'<path d="M12 3c-4.5 0-7 3-7 6H4a2 2 0 0 0 0 4h1a7 7 0 0 0 14 0h1a2 2 0 0 0 0-4h-1c0-3-2.5-6-7-6zM12 4V1M9 14q3 3 6 0"/><path d="M8 9h.01M16 9h.01"/>',
  back:'<path d="m14 6-6 6 6 6"/>', edit:'<path d="m14 4 6 6M3 21l5-1L21 7a2 2 0 0 0-4-4L4 16z"/>',
  chevron:'<path d="m7 10 5 5 5-5"/>', calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 2v6M17 2v6M3 11h18"/>',
  report:'<path d="M14 2H5v20h14V7zM14 2v5h5M8 12h8M8 17h5"/>', arrow:'<path d="m9 6 6 6-6 6"/>'
};
export const flowerIcon = key => `<svg class="flower-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[key] || paths.overview}</svg>`;

// The only persisted value is a global presentation preference, never a patient ID or content.
export function readFlowerCompact(view) {
  try {return view.localStorage.getItem('fizira:flower-compact') === '1';} catch {return false;}
}
export function saveFlowerCompact(view, compact) {
  try {view.localStorage.setItem('fizira:flower-compact',compact ? '1' : '0');} catch { /* Private browsing still supports the current view. */ }
}

export async function collapsePatientFlower(root) {
  if (root.classList.contains('is-compact')) return;
  const view = root.ownerDocument.defaultView;
  root.querySelector('[data-flower-toggle]').click();
  if (!view.matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise(resolve => view.setTimeout(resolve,260));
}

export function patientFlowerHtml({patient, tab, age, sex, dob, compact = false}) {
  return `<section class="patient-flower ${compact ? 'is-compact' : ''}" aria-label="Карточка пациента">
    <div class="flower-toolbar">
      <button id="backPatients" class="flower-tool" type="button">${flowerIcon('back')}<span>Пациенты</span></button>
      <button id="editPatient" class="flower-tool flower-edit" type="button" aria-label="Редактировать карточку" title="Редактировать карточку">${flowerIcon('edit')}</button>
      <button class="flower-tool flower-toggle" type="button" data-flower-toggle aria-expanded="${!compact}" aria-controls="patientFlowerStage">${flowerIcon('chevron')}<span>${compact ? 'Развернуть' : 'Свернуть'}</span></button>
    </div>
    <div class="flower-stage" id="patientFlowerStage">
      <nav class="patient-tabs flower-navigation" aria-label="Разделы карточки пациента">
        ${patientSections.map(([key,label],i) => {
          const angle = -90 + i * 360/7, radians = angle * Math.PI/180;
          const compactX=[-1,-.71,-.36,0,.36,.71,1][i], compactY=[.50,.68,.79,.83,.79,.68,.50][i];
          return `<button type="button" class="flower-petal ${key === tab ? 'is-active' : ''}" data-tab="${key}" aria-controls="tabContent" ${key === tab ? 'aria-current="page"' : ''} style="--compact-x:${compactX};--compact-y:${compactY};--compact-turn:${[-38,-26,-13,0,13,26,38][i]}deg;--petal-x:${Math.cos(radians).toFixed(4)};--petal-y:${Math.sin(radians).toFixed(4)};--petal-turn:${(angle+90).toFixed(2)}deg">
            <svg class="flower-petal-shape" viewBox="0 0 120 132" preserveAspectRatio="none" aria-hidden="true"><path d="M12 25Q60 -9 108 25Q123 38 113 69L87 121Q60 139 33 121L7 69Q-3 38 12 25Z"/></svg>
            <span class="flower-petal-content">${flowerIcon(key)}<span>${esc(label)}</span><span class="flower-active-mark" aria-hidden="true"></span></span>
          </button>`;
        }).join('')}
      </nav>
      <section class="patient-hero flower-identity" aria-labelledby="flowerPatientName">
        <span class="flower-avatar">${flowerIcon('child')}</span>
        <div class="flower-identity-copy"><h1 id="flowerPatientName" title="${esc(patient.display_name)}">${esc(patient.display_name || 'Имя не указано')}</h1>
          <div class="patient-hero-meta">${esc(age)} · ${esc(sex)}</div>
          <div class="patient-hero-date">${esc(dob)}</div>
        </div>
        <button type="button" class="flower-complaint" data-patient-details aria-haspopup="dialog" aria-label="Сведения о пациенте и полная причина обращения">
          <span>Причина обращения</span><strong>${esc(patient.primary_complaint || 'Пока не указана')}</strong>
        </button>
        <div class="flower-ai-host"></div>
      </section>
    </div>
    <p class="flower-scroll-hint">Сдвиньте разделы, чтобы увидеть все <span aria-hidden="true">→</span></p>
    <details class="flower-support"><summary>ИИ и документы</summary><div class="actions patient-hero-actions"></div></details>
    <dialog class="flower-details-dialog" aria-labelledby="flowerDetailsTitle"><div>
      <h2 id="flowerDetailsTitle">${esc(patient.display_name || 'Пациент')}</h2><div class="muted">${esc(age)} · ${esc(sex)} · ${esc(dob)}</div>
      <h3>Причина обращения</h3><p>${esc(patient.primary_complaint || 'Причина обращения пока не заполнена')}</p>
      <button type="button" class="btn" data-close-details>Закрыть</button>
    </div></dialog>
  </section>`;
}

export function mountPatientFlower({root, isCurrent, navigate}) {
  const view = root.ownerDocument.defaultView, toggle = root.querySelector('[data-flower-toggle]');
  toggle.onclick = () => {
    if (!isCurrent() || !root.isConnected) return;
    const compact = root.classList.toggle('is-compact');
    saveFlowerCompact(view, compact);
    toggle.setAttribute('aria-expanded',String(!compact));
    toggle.querySelector('span').textContent = compact ? 'Развернуть' : 'Свернуть';
    updateScrollHint();
  };
  const nav = root.querySelector('.flower-navigation');
  const buttons = [...nav.querySelectorAll('[data-tab]')];
  let navigating = false;
  for (const button of buttons) button.onclick = async () => {
    if (navigating || !isCurrent() || !root.isConnected) return;
    navigating = true;buttons.forEach(b => {b.disabled = true;});
    try {await navigate(button.dataset.tab);} finally {navigating = false;if (root.isConnected) buttons.forEach(b => {b.disabled = false;});}
  };
  nav.onkeydown = event => {
    if (!isCurrent()) return;
    const index = buttons.indexOf(root.ownerDocument.activeElement);
    if (index < 0) return;
    const next = {ArrowRight:(index+1)%buttons.length, ArrowLeft:(index-1+buttons.length)%buttons.length, Home:0, End:buttons.length-1}[event.key];
    if (next === undefined) return;
    event.preventDefault();buttons[next].focus({preventScroll:true});
    if (root.classList.contains('is-compact')) buttons[next].scrollIntoView({block:'nearest',inline:'nearest'});
  };
  function updateScrollHint() {
    if (!root.isConnected) return;
    root.querySelector('.flower-scroll-hint').hidden = !root.classList.contains('is-compact') || nav.scrollWidth <= nav.clientWidth;
    nav.onscroll();
  }
  view.requestAnimationFrame(updateScrollHint);
  nav.onscroll = () => {root.dataset.navEnd = nav.scrollLeft + nav.clientWidth >= nav.scrollWidth-2 ? 'true' : 'false';};
  if (view.ResizeObserver) {
    const resize = new view.ResizeObserver(updateScrollHint);
    const removed = new view.MutationObserver(() => {if (!root.isConnected) {resize.disconnect();removed.disconnect();}});
    resize.observe(nav);
    removed.observe(root.parentNode,{childList:true});
  }
  const dialog = root.querySelector('dialog');
  root.querySelector('[data-patient-details]').onclick = () => {if (isCurrent()) dialog.showModal();};
  root.querySelector('[data-close-details]').onclick = () => dialog.close();
  dialog.onclick = event => {if (event.target === dialog) dialog.close();};
}
