import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {escapeHtml} from '../security-utils.mjs';
import {mountParentReportWorkspace, leaveParentReportWorkspace} from '../parent-report-workspace.mjs';

export const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
export const patientRenderer = source.slice(source.indexOf('function renderPatient('), source.indexOf('function option('));
const tabStart = source.indexOf('function renderTab(');
const contactsStart = source.indexOf(" box.insertAdjacentHTML('beforeend', `\n  <div class=\"card contacts-workspace\"", tabStart);
export const overviewRenderer = source.slice(tabStart, contactsStart) + '\n}';
export const fictionalPatient = {id:'child-a', therapist_id:'owner', display_name:'Михаил Тестовый', date_of_birth:'2021-04-12', sex:'male', primary_complaint:'Трудности с равновесием'};

export async function flowerFixture(options = {}) {
  const window = new Window({url:'https://fizira.test'}), document = window.document;
  document.body.innerHTML = '<main id="app"></main>';
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const calls = [], patient = {...fictionalPatient, ...options.patient};
  const state = {patientId:patient.id, patients:[patient], tab:'overview', contacts:[], goals:[], sessions:[], parentReports:[], profile:{}, aiDocumentIdsByPatient:{}, ...options.state};
  const sb = {from(table) {
    let filters = [];
    const q = new Proxy({then(resolve) {
      calls.push({table, filters});
      return Promise.resolve({data:options.rows?.[table] || (table === 'parent_session_reports' ? state.parentSessionReports : []) || [], error:null}).then(resolve);
    }}, {get(target, key) {return target[key] || ((...args) => {if(key === 'eq') filters.push(args); return q;});}});
    return q;
  }};
  let modules = {};
  try { modules = {...await import('../patient-flower.mjs'), ...await import('../patient-overview.mjs')}; } catch (e) {if(e.code !== 'ERR_MODULE_NOT_FOUND') throw e;}
  const env = {window, document, app:document.querySelector('main'), state, user:{id:'owner',email:'fictional@example.test'}, authViewRevision:1, passwordRecoveryActive:false,
    roleGate:{canNavigate:() => true}, sb, SUPABASE_URL:'https://auth.fizira.test', currentPatient:() => patient, esc:escapeHtml,
    ageFromDob:() => '5 лет', sexLabel:() => 'Мальчик', fmtDate:x => x,
    renderPatients:() => calls.push({action:'patients'}), renderEditPatient:() => calls.push({action:'edit'}),
    mountParentReportWorkspace, leaveParentReportWorkspace, prepareParentReportDraft:async() => ({complaint:'Вымышленная жалоба'}),
    loadAiAnalysisHistory:async() => [], loadPatientData:async() => {}, renderParentPortalSpecialist:() => {},
    openScheduleEditor:options => calls.push({action:'schedule',options}), ...modules};
  const render = new Function('env', `with(env){${patientRenderer}\n${options.overview ? overviewRenderer : 'function renderTab(){env.renderedTab = state.tab;}'}\nreturn renderPatient;}`)(env);
  render();
  return {window, document, env, state, patient, calls, render, async settle(){await window.happyDOM.waitUntilComplete();}, async close(){env.app.querySelector('.parent-report-workspace')?.parentReportController?.dispose();await window.happyDOM.abort();}};
}
