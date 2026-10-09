import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Window} from 'happy-dom';
import {escapeHtml} from '../security-utils.mjs';
const root=new URL('../',import.meta.url),base='51e18c88377a7b20d06eef24b0db9fcb6d45fd3a';
const source=await readFile(new URL('app.js',root),'utf8');
const baseline=JSON.parse(await readFile(new URL('fixtures/production-source-51e18c8.json',import.meta.url),'utf8'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
test('isolated Flower release leaves all backend and PDF export bytes at production baseline',async()=>{
 assert.equal(baseline.baseSha,base);
 for(const [file,expected] of Object.entries({...baseline.unchangedFiles,...baseline.approvedFlowerAssets})) {
  assert.equal(sha256(await readFile(new URL(file,root))),expected,file);
 }
 for(const {start,source:block} of baseline.preservedReportHandlers){
  const preserved=source.replace(/    box\.refreshReportHistory\?\.\(\);\n    overviewRoot\?\.refreshOverview\?\.\(\);\n/g,'').replace(/box\.querySelectorAll\(/g,'document.querySelectorAll(').replace(/box\n  \.querySelectorAll\(/g,'document\n  .querySelectorAll(').replace(/if \(navigateSection\?\.refresh\) await navigateSection\.refresh\('overview'\); else renderPatient\(\);/g,'renderPatient();');
  assert.ok(block.length>100);assert.ok(preserved.includes(block.trim()),start);
 }
 assert.doesNotMatch(source,/from ['"]\.\/parent-report-workspace/);

});
test('mobile Flower mounts over production renderer and expanding keeps its DOM',async()=>{
 const window=new Window({url:'https://fizira.test'});window.happyDOM.setWindowSize({width:390,height:844});
 const document=window.document;document.body.innerHTML='<main id="app"></main>';window.HTMLElement.prototype.scrollIntoView=()=>{};
 let modules={};try{modules={...await import('../patient-flower.mjs'),...await import('../patient-overview.mjs')};}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
 const patient={id:'fictional-child',therapist_id:'fictional-owner',display_name:'Михаил Тестовый',date_of_birth:'2021-04-12',sex:'male',primary_complaint:'Вымышленная жалоба'};
 const q=new Proxy({then:resolve=>Promise.resolve({data:[],error:null}).then(resolve)},{get:(t,k)=>t[k]||(()=>q)});
 const env={sb:{from:()=>q},SUPABASE_URL:'https://auth.fizira.test',window,document,app:document.querySelector('main'),state:{patientId:patient.id,patients:[patient],tab:'overview',contacts:[],goals:[],sessions:[],parentReports:[],profile:{},aiDocumentIdsByPatient:{}},user:{id:patient.therapist_id,email:'fictional@example.test'},authViewRevision:1,passwordRecoveryActive:false,roleGate:{canNavigate:()=>true},currentPatient:()=>patient,esc:escapeHtml,ageFromDob:()=> '5 лет',sexLabel:()=> 'Мальчик',fmtDate:x=>x,formatAIAnalysisBlock:escapeHtml,renderPatients(){},renderEditPatient(){},loadAiAnalysisHistory:async()=>[],loadPatientData:async()=>{},...modules};
 try{
  const renderer=source.slice(source.indexOf('function renderPatient('),source.indexOf('function option('));
  new Function('env','with(env){'+renderer+'\nfunction renderTab(){document.getElementById("tabContent").innerHTML="<textarea data-draft></textarea>";}\nrenderPatient();}')(env);
  const flower=document.querySelector('.patient-flower');assert.ok(flower,'existing production renderer must mount approved Flower');
  assert.equal(document.querySelectorAll('.flower-petal').length,7);
  assert.equal(document.querySelector('#flowerPatientName').textContent,'Михаил');
  const field=document.querySelector('[data-draft]');field.value='Несохранённый вымышленный текст';
  document.querySelector('[data-flower-expand]').click();
  assert.equal(document.querySelector('.patient-flower'),flower);
  assert.equal(document.querySelector('[data-draft]'),field);assert.equal(field.value,'Несохранённый вымышленный текст');
 }finally{await window.happyDOM.abort();}
});
