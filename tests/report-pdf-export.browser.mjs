import test from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdir} from 'node:fs/promises';import {createServer} from 'node:http';import {chromium} from 'playwright-core';
import { reportOpenSource, reportPdfMountSource, reportOpenHtml } from './report-history-fixture.mjs';
const root=new URL('../',import.meta.url);
test('actual editor mobile/desktop: download, activated file share, cancel and unsaved text',async t=>{
 assert.ok(process.env.CHROMIUM_EXECUTABLE,'Chromium required');
 const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"><main style="max-width:800px;margin:16px auto;padding:12px"></main>');return;}if(!/^\/[a-z-]+\.(?:js|mjs|css)$/.test(path)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(new URL(path.slice(1),root)));}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const width of [394,1366])await t.test(`${width}px`,async()=>{
   const page=await browser.newPage({viewport:{width,height:854},isMobile:width===394,hasTouch:width===394});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(`http://127.0.0.1:${server.address().port}/`);
   await page.evaluate(async()=>{
    const {renderParentSessionReportEditor}=await import('/parent-specialist.js');window.exportCalls=[];window.shareCalls=[];window.shareMode='cancel';
    const report={id:'report',patient_id:'child',therapist_id:'owner',session_id:'session',publication_status:'draft',created_at:'2026-10-07',what_did:'Вымышленный текст'};
    const sb={from(table){let op='select',payload,one=false;const q={select(){return q},eq(){return q},order(){return q},single(){one=true;return q},update(v){op='update';payload=v;return q},delete(){op='delete';return q},then(resolve){if(op==='update')Object.assign(report,payload);return Promise.resolve({data:table==='parent_session_reports'?(one?report:[report]):[],error:null}).then(resolve)}};return q},functions:{invoke:async(name,{body})=>{window.exportCalls.push({name,body});return {data:new Blob(['%PDF-1.7\nfictional browser PDF'],{type:'application/pdf'})}}}};
    Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>window.shareMode!=='fallback'});Object.defineProperty(navigator,'share',{configurable:true,value:data=>{window.shareCalls.push({active:navigator.userActivation.isActive,keys:Object.keys(data),name:data.files[0].name,type:data.files[0].type});return window.shareMode==='cancel'?Promise.reject(new DOMException('cancel','AbortError')):Promise.resolve()}});
    await renderParentSessionReportEditor({root:document.querySelector('main'),sb,user:{id:'owner'},patient:{id:'child',therapist_id:'owner'},session:{id:'session',patient_id:'child',therapist_id:'owner'},isCurrent:()=>true});
   });
   await page.locator('[data-prepare-pdf]').click();await page.getByText(/PDF готов/).waitFor();const downloads=[];page.on('download',d=>downloads.push(d));await page.locator('[data-share-pdf]').click();await page.getByText(/Передача отменена/).waitFor();assert.equal(downloads.length,0);assert.equal(await page.locator('[data-share-pdf]').isEnabled(),true);
   await page.evaluate(()=>window.shareMode='share');await page.locator('[data-share-pdf]').click();await page.getByText('PDF передан системному меню.',{exact:true}).waitFor();const shares=await page.evaluate(()=>window.shareCalls);assert.equal(shares.length,2);for(const s of shares){assert.equal(s.active,true);assert.deepEqual(s.keys,['files']);assert.equal(s.name,'Fizira-report.pdf');assert.equal(s.type,'application/pdf');}
   await page.evaluate(()=>window.shareMode='fallback');const promise=page.waitForEvent('download');await page.locator('[data-share-pdf]').click();const downloaded=await promise;assert.equal(downloaded.suggestedFilename(),'Fizira-report.pdf');assert.match((await readFile(await downloaded.path())).toString(),/^%PDF-/);const direct=page.waitForEvent('download');await page.locator('[data-download-pdf]').click();assert.equal((await direct).suggestedFilename(),'Fizira-report.pdf');
   const metrics=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('.report-pdf-export button')].map(b=>{const r=b.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}})}));assert.ok(metrics.scroll<=width,JSON.stringify(metrics));for(const b of metrics.buttons)assert.ok(b.left>=0&&b.right<=width+1&&b.width>0,JSON.stringify(b));
   if(process.env.RESPONSIVE_SCREENSHOT_DIR){await mkdir(process.env.RESPONSIVE_SCREENSHOT_DIR,{recursive:true});await page.locator('main').screenshot({path:`${process.env.RESPONSIVE_SCREENSHOT_DIR}/pdf-export-${width}.png`});}
   await page.locator('[name=what_did]').fill('Несохранённый текст');assert.equal(await page.locator('[data-share-pdf]').isDisabled(),true);await page.locator('[data-prepare-pdf]').click();await page.getByText(/Сначала сохраните/).waitFor();assert.equal((await page.evaluate(()=>window.exportCalls)).length,1);assert.deepEqual(errors,[]);await page.close();
  });
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});

test('mobile history click opens frozen report text and shares a file without Parent Cabinet',async()=>{
 const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"><main style="padding:12px"></main>');return;}if(!/^\/[a-z-]+\.(?:js|mjs|css)$/.test(path)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(new URL(path.slice(1),root)));}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async ({reportOpenSource,reportPdfMountSource,reportOpenHtml})=>{
   const {mountReportPdfExport}=await import('/report-pdf-export.mjs');document.querySelector('main').innerHTML=reportOpenHtml;
   window.exportCalls=[];window.shareCalls=[];window.navigations=0;
   const report={id:'report',patient_id:'child',therapist_id:'owner',publication_status:'published',published_at:'2026-10-01',published_snapshot:{complaint:'Сохранённое заключение консультации',therapist_name:'Специалист'},complaint:'Другой текущий текст'};
   const env={window,document,box:document,mountReportPdfExport,state:{tab:'overview',parentReports:[report],profile:{}},user:{id:'owner',user_metadata:{}},p:{id:'child'},parentReportEditor:document.getElementById('parentReportEditor'),editParentReportBtn:document.getElementById('editParentReportBtn'),saveParentReportPdfBtn:document.getElementById('saveParentReportPdfBtn'),generateParentReportBtn:document.getElementById('generateParentReportBtn'),editingParentReportId:null,parentReportEditorRevision:0,accountIsCurrent:()=>true,setParentReportStatus(){},renderPatient(){window.navigations++;},sb:{functions:{invoke:async(name,{body})=>{window.exportCalls.push({name,body});return {data:new Blob(['%PDF-1.7\nfictional frozen report'],{type:'application/pdf'})}}}}};
   window.reportEnvironment=env;
   Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:data=>{window.shareCalls.push({active:navigator.userActivation.isActive,keys:Object.keys(data),type:data.files[0].type});return Promise.resolve();}});
   new Function('env',`with(env){${reportPdfMountSource}\n${reportOpenSource}}`)(env);
  },{reportOpenSource,reportPdfMountSource,reportOpenHtml});
  await page.locator('[data-open-parent-report]').click();
  assert.equal(await page.locator('#reportComplaint').inputValue(),'Сохранённое заключение консультации');
  assert.equal(await page.locator('#reportComplaint').evaluate(el=>el.readOnly),true);
  assert.equal(await page.locator('#editParentReportBtn').isVisible(),false);
  assert.equal(await page.locator('#saveParentReportPdfBtn').isVisible(),false);
  await page.locator('[data-pdf-parent-report]').click();
  await page.locator('[data-prepare-pdf]').click();await page.getByText(/PDF готов/).waitFor();
  await page.locator('[data-share-pdf]').click();await page.getByText('PDF передан системному меню.',{exact:true}).waitFor();
  const result=await page.evaluate(()=>({tab:window.reportEnvironment.state.tab,navigations:window.navigations,exports:window.exportCalls,shares:window.shareCalls}));
  assert.equal(result.tab,'overview');assert.equal(result.navigations,0);assert.deepEqual(result.exports,[{name:'generate-parent-report-pdf',body:{report_id:'report',report_kind:'initial',mode:'export'}}]);assert.deepEqual(result.shares,[{active:true,keys:['files'],type:'application/pdf'}]);assert.deepEqual(errors,[]);
  await page.close();
 } finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
});
