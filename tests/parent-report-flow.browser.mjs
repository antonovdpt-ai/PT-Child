import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {renderParentPublicationPdf} from '../supabase/functions/_shared/parent-pdf.ts';

const root=new URL('../',import.meta.url);
const source=await readFile(new URL('app.js',root),'utf8');
const start=source.indexOf('function renderTab('),stop=source.indexOf(" box.insertAdjacentHTML('beforeend', `\n  <div class=\"card contacts-workspace\"",start);
assert.ok(start>0&&stop>start);
const initialRenderer=source.slice(start,stop)+'\n}';
const patientRenderer=source.slice(source.indexOf('function renderPatient('),source.indexOf('function option('));
const shell=(await readFile(new URL('index.html',root),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');

test('actual consultation flow renders, saves, previews, downloads and shares on mobile/desktop',async t=>{
 assert.ok(process.env.CHROMIUM_EXECUTABLE,'Chromium required');
 const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/fixture'){res.setHeader('Content-Type','text/html');res.end(shell);return;}
  if(path==='/render.pdf'&&req.method==='POST'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const snapshot=JSON.parse(Buffer.concat(chunks).toString());
   const bytes=await renderParentPublicationPdf(snapshot);res.setHeader('Content-Type','application/pdf');res.end(bytes);return;
  }
  if(!/^\/[a-zA-Z0-9.-]+$/.test(path)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':'text/javascript');
  res.end(await readFile(new URL(path.slice(1),root)));
 }catch{res.writeHead(500);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const width of [390,1366])await t.test(`${width}px`,async()=>{
   const page=await browser.newPage({viewport:{width,height:854},isMobile:width===390,hasTouch:width===390});const errors=[],dialogs=[],requests=[];
   page.on('request',r=>requests.push(r.url()));
   page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.message());d.dismiss();});
   await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
   await page.evaluate(async ({initialRenderer,patientRenderer})=>{
    const {mountParentReportWorkspace,leaveParentReportWorkspace}=await import('/parent-report-workspace.mjs');
    const {escapeHtml}=await import('/security-utils.mjs');
    const flower=await import('/patient-flower.mjs'),overview=await import('/patient-overview.mjs');
    const p={id:'fictional-child',therapist_id:'fictional-owner',display_name:'Тестовый ребёнок'};
    const state={tab:'overview',patientId:p.id,parentReports:[],profile:{full_name:'Анна Тестовая',profession:'Физический терапевт',phone:'+7 000'}};
    window.reportCalls=[];window.savedReports=[];window.shareCalls=[];window.shareMode='cancel';window.failReportSave=false;
    const sb={from(table){if(table!=='parent_reports')throw Error('Unexpected table');let op='select',payload,filters=[];
     const q={insert(value){op='insert';payload=value;return q},update(value){op='update';payload=value;return q},select(){return q},eq(key,value){filters.push([key,value]);return q},single(){return q},then(resolve){
      window.reportCalls.push({op,payload,filters});let row=window.savedReports.find(r=>filters.every(([key,value])=>r[key]===value));
      if(window.failReportSave)return Promise.resolve({error:{message:'synthetic save failure'}}).then(resolve);
      if(op==='insert'){row={...payload,id:'report-1',publication_status:'draft',created_at:'2026-10-08T12:00:00Z'};window.savedReports.push(row);}
      else if(op==='update'&&row)Object.assign(row,payload);
      return Promise.resolve({data:row?structuredClone(row):null,error:row?null:{message:'missing'}}).then(resolve);
     }};return q;},functions:{invoke:async(name,{body})=>{
      window.reportCalls.push({name,body});const row=window.savedReports.find(r=>r.id===body.report_id);if(!row)throw Error('Wrong identity');
      const response=await fetch('/render.pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schema_version:1,report_kind:'initial',revision:1,source_date:'2026-10-08',child_name:p.display_name,...row})});
      return {data:await response.blob()};
     }}};
    Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>window.shareMode!=='fallback'});
    Object.defineProperty(navigator,'share',{configurable:true,value:data=>{window.shareCalls.push({active:navigator.userActivation.isActive,keys:Object.keys(data),type:data.files[0].type,name:data.files[0].name});return window.shareMode==='cancel'?Promise.reject(new DOMException('cancel','AbortError')):Promise.resolve();}});
    document.body.classList.add('is-authenticated');document.body.dataset.specialistReady='true';
    const env={...flower,...overview,window,document,state,sb,p,app:document.getElementById('app'),authViewRevision:1,user:{id:p.therapist_id,user_metadata:{}},roleGate:{canNavigate:()=>true},mountParentReportWorkspace,leaveParentReportWorkspace,
     passwordRecoveryActive:false,currentPatient:()=>p,esc:escapeHtml,ageFromDob:()=> '6 лет',sexLabel:()=>'',fmtDate:x=>x,renderEditPatient(){},renderPatients(){},
     prepareParentReportDraft:async()=>({complaint:'Причина обращения',strengths:'Самостоятельно меняет положение на полу.',observations:'Наблюдения специалиста',goals:'Цели терапии',recommendations:'Исходная рекомендация'}),loadPatientData(){throw Error('Must not reload the card during autosave');},renderPatient(){throw Error('Unexpected navigation');}};
    window.reportEnvironment=env;
    new Function('env',`with(env){${initialRenderer}\n${patientRenderer}\nrenderPatient();}`)(env);
   },{initialRenderer,patientRenderer});
   assert.equal(await page.locator('.parent-report-workspace button:visible').count(),1);
   await page.locator('[data-start-report]').click();await page.locator('[data-save-status]').getByText('✓ Сохранено',{exact:true}).waitFor();
   await page.locator('[name=recommendations]').fill('Самая свежая рекомендация. Сохранить перед PDF.');
   await page.locator('[data-prepare-pdf]').click();await page.locator('[data-pdf-ready]').waitFor({state:'visible'});
   assert.equal(await page.locator('[data-report-fields]').isVisible(),false);
   assert.equal(await page.locator('[data-share-pdf]').isVisible(),true);assert.equal(await page.locator('[data-prepare-pdf]').isVisible(),false);
   assert.equal(await page.evaluate(()=>window.savedReports.length),1);assert.equal(await page.evaluate(()=>window.savedReports[0].recommendations),'Самая свежая рекомендация. Сохранить перед PDF.');
   await page.locator('[data-pdf-preview][data-ready="true"]').waitFor();
   const ink=await page.locator('[data-pdf-preview] canvas').evaluate(canvas=>{const p=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let n=0;for(let i=0;i<p.length;i+=4)if(p[i]<220||p[i+1]<220||p[i+2]<220)n++;return n;});assert.ok(ink>1000,`Visible document ink: ${ink}`);
   assert.match(await page.locator('[data-pdf-preview-note]').textContent(),/Страница 1 из 1/);
   await page.locator('[data-share-pdf]').click();await page.getByText(/Передача отменена/).waitFor();assert.equal(await page.locator('[data-share-pdf]').isEnabled(),true);
   await page.evaluate(()=>window.shareMode='share');await page.locator('[data-share-pdf]').click();await page.getByText('PDF передан системному меню.',{exact:true}).waitFor();
   const shares=await page.evaluate(()=>window.shareCalls);assert.equal(shares.length,2);for(const s of shares){assert.equal(s.active,true);assert.deepEqual(s.keys,['files']);assert.equal(s.type,'application/pdf');}
   const downloaded=page.waitForEvent('download');await page.locator('[data-download-pdf]').click();const download=await downloaded;
   assert.equal(download.suggestedFilename(),'Fizira-report.pdf');const path=await download.path();assert.ok((await readFile(path)).subarray(0,5).toString()==='%PDF-');
   const text=spawnSync('pdftotext',[path,'-'],{encoding:'utf8'});assert.equal(text.status,0);for(const phrase of ['Самая свежая рекомендация','Тестовый ребёнок','Анна Тестовая','Fizira'])assert.ok(text.stdout.includes(phrase),phrase);
   const metrics=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('.report-pdf-export button')].filter(b=>!b.hidden).map(b=>{const r=b.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height}})}));
   assert.ok(metrics.scroll<=width,JSON.stringify(metrics));for(const b of metrics.buttons)assert.ok(b.left>=0&&b.right<=width+1&&b.height>=44,JSON.stringify(b));
   await page.locator('[data-report-editor]').evaluate(e=>e.scrollIntoView({block:'start',behavior:'instant'}));
   const heading=await page.locator('[data-editor-heading]').boundingBox();assert.ok(heading.y>= (width===390?56:60),JSON.stringify(heading));
   if(process.env.RESPONSIVE_SCREENSHOT_DIR){await mkdir(process.env.RESPONSIVE_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:`${process.env.RESPONSIVE_SCREENSHOT_DIR}/parent-report-ready-${width}.png`,fullPage:true});}
   await page.locator('[data-edit-pdf]').click();await page.locator('[name=complaint]').fill('Новая правка после PDF');assert.equal(await page.locator('[data-share-pdf]').isVisible(),false);await page.locator('[data-close-report]').click();
   assert.equal(await page.evaluate(()=>window.savedReports[0].complaint),'Новая правка после PDF');
   await page.locator('.parent-report-history details').evaluate(el=>el.open=true);await page.locator('[data-open-parent-report]').click();assert.equal(await page.locator('[name=complaint]').inputValue(),'Новая правка после PDF');
   await page.evaluate(()=>window.failReportSave=true);await page.locator('[name=complaint]').fill('Сохранение перед переходом временно недоступно');await page.locator('[data-tab=progress]').click();await page.locator('[data-save-status]').getByText(/Изменения пока не сохранены/).waitFor();assert.equal(await page.evaluate(()=>window.reportEnvironment.state.tab),'overview');assert.equal(await page.locator('[name=complaint]').inputValue(),'Сохранение перед переходом временно недоступно');await page.evaluate(()=>window.failReportSave=false);
   await page.locator('[name=complaint]').fill('Последняя правка перед переходом');await page.locator('[data-tab=progress]').click();await page.waitForFunction(()=>window.reportEnvironment.state.tab==='progress');assert.equal(await page.evaluate(()=>window.savedReports[0].complaint),'Последняя правка перед переходом');
   await page.locator('[data-tab=overview]').click();await page.locator('[data-report-editor]').waitFor({state:'visible'});assert.equal(await page.locator('[name=complaint]').inputValue(),'Последняя правка перед переходом');
   await page.locator('[data-close-report]').click();await page.locator('.parent-report-history details').evaluate(el=>el.open=true);await page.locator('[data-open-parent-report]').click();assert.equal(await page.locator('[name=complaint]').inputValue(),'Последняя правка перед переходом');
   if(width===390){
    await page.locator('[name=recommendations]').fill('Фиктивная рекомендация: повторять движение в спокойном темпе с поддержкой специалиста. '.repeat(120)+'Завершение длинного отчёта.');await page.locator('[data-prepare-pdf]').click();await page.locator('[data-pdf-preview][data-ready="true"]').waitFor();
    const pages=Number((await page.locator('[data-pdf-preview-note]').textContent()).match(/из (\d+)/)[1]);assert.ok(pages>1,`Multipage preview: ${pages}`);
    const next=page.waitForEvent('download');await page.locator('[data-download-pdf]').click();const path=await (await next).path();const text=spawnSync('pdftotext',[path,'-'],{encoding:'utf8'});assert.equal(text.status,0);assert.ok(text.stdout.includes('Завершение длинного отчёта'));
   }
   assert.deepEqual(requests.filter(url=>!url.startsWith(`http://127.0.0.1:${server.address().port}/`)&&!url.startsWith('blob:')),[]);assert.ok(requests.some(url=>url.includes('pdfjs-worker-5.6.205.min.mjs')));
   assert.equal(await page.evaluate(()=>window.reportEnvironment.state.tab),'overview');assert.deepEqual(dialogs,[]);assert.deepEqual(errors,[]);await page.close();
  });
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});
