import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium} from 'playwright-core';
const root=new URL('../',import.meta.url);
const source=await readFile(new URL('app.js',root),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const snippets={header:slice('function renderHeader()','function setButtonSaving('),patient:slice('function renderPatient(','function option('),tab:slice('function renderTab(','let editingContactId = null;')+'}'};
const html=(await readFile(new URL('index.html',root),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');

test('actual specialist renderer fits all requested widths with contact form and long labels',async t=>{
 assert.ok(process.env.CHROMIUM_EXECUTABLE,'Set CHROMIUM_EXECUTABLE to a installed Chromium binary; no browser test is silently skipped.');
 const server=createServer(async(req,res)=>{
  try {
   const path=new URL(req.url,'http://localhost').pathname;
   if(path==='/fixture'){res.setHeader('Content-Type','text/html');res.end(html);return;}
   if(!/^\/[a-zA-Z0-9.-]+$/.test(path)){res.writeHead(404);res.end();return;}
   res.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.js')||path.endsWith('.mjs')?'text/javascript':'image/png');
   res.end(await readFile(new URL(path.slice(1),root)));
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  for(const width of [375,390,430,768,1440])await t.test(`${width}px`,async()=>{
   const page=await browser.newPage({viewport:{width,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
   await page.evaluate(async snippets=>{
    const {renderParentPortalSpecialist,renderParentSessionReportEditor}=await import('/parent-specialist.js');
    const {escapeHtml}=await import('/security-utils.mjs');
    const patient={id:'fictional-child',therapist_id:'fictional-specialist',display_name:'Тестовый ребёнок '+('Оченьдлинноеимя'.repeat(5)),date_of_birth:'2020-04-15',primary_complaint:'Вымышленные данные для проверки вёрстки '+('Длинныйтекст'.repeat(20))};
    const contacts=[{id:'fictional-contact',patient_id:patient.id,therapist_id:patient.therapist_id,full_name:'Анна Тестовая '+('Длиннаяфамилия'.repeat(8)),relation:'Законный представитель',email:'long.test.address@example.test',phone:'+70000000000'}];
    const sb={from(){const q=new Proxy({then(resolve){return Promise.resolve({data:[],error:null}).then(resolve)}},{get(target,key){return target[key]||(()=>q)}});return q;},functions:{invoke:async()=>({data:{ok:true,expires_at:'2099-01-01'},error:null})}};
    const env={document,window,app:document.getElementById('app'),headerActions:document.getElementById('headerActions'),user:{id:patient.therapist_id,email:'fictional.specialist@example.test'},state:{patientId:patient.id,tab:'parent',contacts,aiDocumentIdsByPatient:{},sessions:[],goals:[]},authViewRevision:1,passwordRecoveryActive:false,roleGate:{canNavigate:()=>true},sb,SUPABASE_URL:'https://auth.fizira.com',currentPatient:()=>patient,esc:escapeHtml,ageFromDob:()=> '6 лет',sexLabel:()=> 'Пол не указан',fmtDate:v=>v,renderPatients(){},renderEditPatient(){},loadPatientData:async()=>{},renderParentPortalSpecialist,renderParentSessionReportEditor};
    new Function('env',`with(env){${snippets.header}\n${snippets.patient}\n${snippets.tab}\nrenderHeader();renderPatient();}`)(env);
    document.body.dataset.specialistReady='true';document.body.classList.add('is-authenticated');
   },snippets);
   await page.locator('[data-add-parent]').waitFor();await page.locator('[data-add-parent]').click();
   await page.locator('[data-parent-contact-form]').waitFor({state:'visible'});
   await page.evaluate(()=>window.scrollTo(0,0));
   const metrics=await page.evaluate(()=>{
    const r=el=>{const x=el.getBoundingClientRect();return {left:x.left,right:x.right,top:x.top,bottom:x.bottom,width:x.width,height:x.height}};
    const selectors=['.patient-hero','.patient-tabs','#tabContent','#deletePatientBtn','[data-parent-contact-form]','#sidePatients','#sideCabinet','#sideProfile','#logoutBtn','#aiHistoryBtn','#editPatient','#backPatients'];
    return {viewport:innerWidth,scroll:document.documentElement.scrollWidth,boxes:selectors.map(s=>({selector:s,...r(document.querySelector(s))})),nav:[...document.querySelectorAll('.sidebar-nav-item,#logoutBtn')].map(r),tabs:[...document.querySelectorAll('.patient-tabs .tab')].map(r)};
   });
   assert.ok(metrics.scroll<=width,`horizontal overflow ${JSON.stringify(metrics)}`);
   for(const box of metrics.boxes)assert.ok(box.left>=-1&&box.right<=width+1&&box.width>0,`${box.selector} outside viewport: ${JSON.stringify(box)}`);
   for(let i=0;i<metrics.nav.length;i++)for(let j=i+1;j<metrics.nav.length;j++){
    const a=metrics.nav[i],b=metrics.nav[j];assert.ok(a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1,'navigation overlaps logout');
   }
   if(width<701)assert.ok(new Set(metrics.tabs.map(x=>Math.round(x.top))).size>1,'mobile tabs must wrap into rows');
   assert.deepEqual(errors,[]);
   if(process.env.RESPONSIVE_SCREENSHOT_DIR){await mkdir(process.env.RESPONSIVE_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:`${process.env.RESPONSIVE_SCREENSHOT_DIR}/specialist-${width}.png`,fullPage:true});}
   await page.close();
  });
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});
