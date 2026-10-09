import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium} from 'playwright-core';

const root=new URL('../',import.meta.url), source=await readFile(new URL('app.js',root),'utf8');
const slice=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const snippets={identityFormatters:slice('const fmtDate =','const toleranceLabel'),patient:slice('function renderPatient(','function option('),tab:slice('function renderTab(','\ninit().catch('),assessment:slice('function option(','function renderTab('),goals:slice('function goalsHtml(','function renderPatient('),session:slice('const toleranceLabel','function validateNextSessionPlan('),header:slice('function renderHeader()','function setButtonSaving('),dirty:slice('function watchFormDirty(','window.addEventListener(\'beforeunload\''),assessmentControls:slice('function enableAssessmentSectionCollapse(','async function loadProfile(')};
const shell=(await readFile(new URL('index.html',root),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');

async function toggleFlower(page){
  const expand=page.locator('[data-flower-expand]');
  await page.locator(await expand.isVisible()?'[data-flower-expand]':'[data-flower-toggle]').click();
  await page.waitForTimeout(300);
}

async function install(page,variant='normal',expanded=true){
  await page.evaluate(async({snippets,variant})=>{
    const flower=await import('/patient-flower.mjs'),overview=await import('/patient-overview.mjs');
    const {mountParentReportWorkspace,leaveParentReportWorkspace}=await import('/parent-report-workspace.mjs');
    const {renderParentPortalSpecialist,renderParentSessionReportEditor}=await import('/parent-specialist.js');
    const {openScheduleEditor}=await import('/schedule-editor.js');
    const {escapeHtml}=await import('/security-utils.mjs');
    const p={id:'fictional-child',therapist_id:'fictional-owner',schedule_price_kopecks:350000,display_name:variant==='long'?'Михаил Александрович '+('Оченьдлиннаяфамилия'.repeat(8)):'Михаил Тестовый',date_of_birth:'2021-04-12',sex:'male',primary_complaint:variant==='long'?'Длинная причина обращения '+('Описаниебезпробелов'.repeat(70)):'Трудности с равновесием'};
    if(variant==='empty'){p.date_of_birth=null;p.primary_complaint='';}
    const goals=variant==='empty'?[]:[{id:'fictional-goal',patient_id:p.id,title:'Стоять без опоры 10 секунд',progress:35,status:'active',criterion:'В трёх попытках',parent_visible:false}];
    const reports=variant==='empty'?[]:[{id:'fictional-report',patient_id:p.id,therapist_id:p.therapist_id,publication_status:'draft',created_at:'2026-10-06T10:00:00Z',complaint:'Трудности с равновесием',observations:'Вымышленные наблюдения',recommendations:'Проверяемая рекомендация'}];
    const appointment={id:'fictional-appointment',patient_id:p.id,therapist_id:p.therapist_id,kind:'appointment',status:'planned',starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+90000000).toISOString(),price_kopecks:350000,paid_kopecks:0};
    const sessions=variant==='session-report'?[{id:'fictional-session',patient_id:p.id,session_date:'2026-10-07'}]:[];
    const sessionReports=variant==='session-report'?[{id:'fictional-session-report',patient_id:p.id,therapist_id:p.therapist_id,session_id:'fictional-session',created_at:'2026-10-07T10:00:00Z',publication_status:'draft',what_did:'Сохранённый отчёт занятия'}]:[];
    const state={patientId:p.id,patients:[p],tab:'overview',contacts:[],goals,sessions,assessment:null,parentReports:reports,parentSessionReports:sessionReports,profile:{full_name:'Анна Тестовая'},aiDocumentIdsByPatient:{}};
    window.networkCalls=[];window.aiCalls=[];const standardized=[];
    const sb={from(table){let filters=[],op='read',payload,one=false;
      const q=new Proxy({then(resolve){window.networkCalls.push({table,op,filters,payload});let data=table==='appointments'?(variant==='empty'?[]:[appointment]):table==='parent_reports'?reports:table==='parent_session_reports'?sessionReports:table==='goals'?goals:table==='standardized_assessments'?standardized:[];
        for(const [key,value]of filters)data=data.filter(r=>r[key]===value);
        if(['insert','update','upsert'].includes(op)){data=(Array.isArray(payload)?payload:[payload]).map((row,i)=>({...row,id:row?.id||'fictional-saved-'+i,updated_at:'2026-10-08T10:00:00Z'}));if(table==='standardized_assessments'&&['insert','upsert'].includes(op))standardized.push(...data);if(table==='goals'&&op==='insert')goals.push(...data);if(table==='sessions'&&op==='insert')sessions.push(...data);}
        const wait=variant==='saving'&&['goals','sessions'].includes(table)&&op==='insert'?new Promise(r=>window.finishSyntheticSave=r):Promise.resolve();
        return wait.then(()=>({data:one?data[0]||null:data,error:variant==='error'&&table==='appointments'?{message:'Synthetic read failure'}:null})).then(resolve);
      }},{get(target,key){return target[key]||((...args)=>{if(key==='eq')filters.push(args);if(key==='single')one=true;if(['insert','update','delete','upsert'].includes(key)){op=key;payload=args[0];}return q;});}});return q;
    },functions:{invoke:async(name,options)=>{if(name==='ptchild-ai'){window.aiCalls.push([options.body.operation,options.body.patient_id,options.body.input,options.body.files]);if(variant==='ai-error')return {data:null,error:{message:'Synthetic AI failure'}};return {data:{text:'## Краткое резюме\nВымышленные данные'},error:null};}return {data:{ok:true},error:null};}},storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://auth.fizira.test/fictional.jpg'},error:null})})}};
    const env={window,document,app:document.getElementById('app'),headerActions:document.getElementById('headerActions'),p,state,sb,user:{id:p.therapist_id,email:'fictional@example.test',user_metadata:{}},authViewRevision:1,passwordRecoveryActive:false,roleGate:{canNavigate:()=>true},SUPABASE_URL:'https://auth.fizira.test',currentPatient:()=>p,esc:escapeHtml,
      ageFromDob:()=>p.date_of_birth?'5 лет':'Возраст не указан',sexLabel:()=> 'Мальчик',fmtDate:v=>v,renderPatients(){env.app.innerHTML='<div data-patient-list>Пациенты</div>';},renderEditPatient(){env.app.innerHTML='<div data-patient-edit>Редактирование карточки</div>';},renderProfile(){},
      mountParentReportWorkspace,leaveParentReportWorkspace,renderParentPortalSpecialist,renderParentSessionReportEditor,openScheduleEditor,...flower,...overview,...new Function(snippets.identityFormatters+';return {ageFromDob,sexLabel,fmtDate};')(),
      enableVoiceInput(){},prepareParentReportDraft:async()=>({complaint:'Вымышленная жалоба',recommendations:'Вымышленная рекомендация'}),loadPatientData:async()=>{},loadAiAnalysisHistory:async()=>[],buildGeneralAnalysisContext:()=>({}),callAI:async(...args)=>{window.aiCalls.push(args);return '## Краткое резюме\nВымышленные данные';},formatAIAnalysisBlock:a=>escapeHtml(a),formatAIAnalysisDate:x=>x,aiDocumentTypeLabels:{},sleep:ms=>new Promise(r=>setTimeout(r,ms)),setButtonSaving(b){b.disabled=true;},setButtonSaved(b){b.disabled=true;},setButtonError(b){b.disabled=false;},setButtonDirty(button,text){button.textContent=text;}};
    window.flowerEnvironment=env;
    new Function('env',`with(env){${snippets.header}\n${snippets.dirty}\n${snippets.assessmentControls}\n${snippets.session}\n${snippets.goals}\n${snippets.assessment}\n${snippets.patient}\n${snippets.tab}\nenv.renderPatient=renderPatient;renderHeader();renderPatient();}`)(env);
    document.body.classList.add('is-authenticated');document.body.dataset.specialistReady='true';
  },{snippets,variant});
  await page.locator('.overview-appointment[aria-busy="false"]').waitFor();
  await page.locator('[data-overview-report][aria-busy="false"]').waitFor();
  if(expanded&&await page.locator('.patient-flower').evaluate(el=>el.classList.contains('is-compact')))await toggleFlower(page);
}

async function checkFlowerSurfaces(page,mode){
  const geometry=await page.evaluate(mode=>{
    const circle=document.querySelector('.flower-identity').getBoundingClientRect(),cx=circle.left+circle.width/2,cy=circle.top+circle.height/2;
    const buttons=[...document.querySelectorAll('.flower-petal')],paths=buttons.map(b=>b.querySelector(`.flower-petal-${mode}:not(.flower-petal-rim)`));
    const edges=paths.map(path=>{const length=path.getTotalLength(),matrix=path.getScreenCTM();return Array.from({length:120},(_,i)=>{
      const p=path.getPointAtLength(length*i/120);return new DOMPoint(p.x,p.y).matrixTransform(matrix);
    }).filter(p=>Math.hypot(p.x-cx,p.y-cy)>circle.width/2+6);});
    const count=mode==='compact'?6:7;
    const gaps=edges.slice(0,count).map((points,i)=>Math.min(...points.flatMap(a=>edges[(i+1)%7].map(b=>Math.hypot(a.x-b.x,a.y-b.y)))));
    const overlaps=edges.flatMap((points,i)=>paths.flatMap((path,j)=>i===j?[]:points.filter(p=>path.isPointInFill(p.matrixTransform(path.getScreenCTM().inverse()))).map(()=>[i,j])));
    const taps=buttons.map(button=>({key:button.dataset.tab,reachable:['.flower-icon','.flower-petal-content>span'].every(selector=>{
      const r=button.querySelector(selector).getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('.flower-petal')===button;
    })}));
    return {gaps,overlaps,taps,limit:Math.max(3,parseFloat(getComputedStyle(document.querySelector('.flower-stage')).width)*.01)};
  },mode);
  assert.deepEqual(geometry.overlaps,[],`${mode}: painted petals must not intersect`);
  assert.ok(geometry.gaps.every(g=>g<=geometry.limit),`${mode}: keep only a narrow seam ${JSON.stringify(geometry)}`);
  for(const p of geometry.taps)assert.ok(p.reachable,`${mode}: the icon and label must both be tappable: ${p.key}`);
}

async function checkMobileCap(page){
  await checkFlowerIdentity(page);
  const g=await page.evaluate(()=>{
    const root=document.querySelector('.patient-flower'),stage=root.querySelector('.flower-stage').getBoundingClientRect(),circle=root.querySelector('.flower-identity').getBoundingClientRect();
    const buttons=[...root.querySelectorAll('.flower-petal')],paths=buttons.map(b=>b.querySelector('.flower-petal-compact:not(.flower-petal-rim)'));
    const edges=paths.map(p=>{const length=p.getTotalLength(),matrix=p.getScreenCTM();return Array.from({length:160},(_,i)=>{const point=p.getPointAtLength(length*i/160);return new DOMPoint(point.x,point.y).matrixTransform(matrix);});});
    const overlaps=edges.flatMap((points,i)=>paths.flatMap((p,j)=>i===j?[]:points.filter(point=>p.isPointInFill(point.matrixTransform(p.getScreenCTM().inverse()))).map(()=>[i,j])));
    const petals=buttons.map((b,i)=>{
      const r=b.getBoundingClientRect(),m=paths[i].getScreenCTM(),center=new DOMPoint(100,66).matrixTransform(m),base=new DOMPoint(100,130).matrixTransform(m);
      const dx=circle.left+circle.width/2-center.x,dy=circle.top+circle.height/2-center.y,bx=base.x-center.x,by=base.y-center.y;
      const taps=['.flower-icon','.flower-petal-content>span'].map(selector=>{const rect=b.querySelector(selector).getBoundingClientRect();return document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)?.closest('.flower-petal')===b;});
      return {key:b.dataset.tab,width:r.width,height:r.height,taps,baseFacesCircle:(dx*bx+dy*by)/Math.hypot(dx,dy)/Math.hypot(bx,by),fits:edges[i].every(p=>p.x>=stage.left+1&&p.x<=stage.right-1&&p.y>=stage.top+1&&p.y<=stage.bottom-1),font:getComputedStyle(b.querySelector('.flower-petal-content')).fontSize};
    });
    const work=document.querySelector('.patient-work-area').getBoundingClientRect();
    return {height:root.getBoundingClientRect().height,workGap:work.top-stage.bottom,overlaps,petals,scroll:document.documentElement.scrollWidth,viewport:innerWidth};
  });
  assert.ok(g.height<=190,JSON.stringify(g));assert.ok(g.workGap>=0&&g.workGap<=9,JSON.stringify(g));assert.ok(g.scroll<=g.viewport,JSON.stringify(g));assert.deepEqual(g.overlaps,[],`Compact painted petals must not intersect: ${JSON.stringify(g)}`);
  for(const p of g.petals){assert.ok(p.fits,JSON.stringify(p));assert.ok(p.width>=44&&p.height>=44,JSON.stringify(p));assert.ok(p.taps.every(Boolean),JSON.stringify(p));assert.ok(p.baseFacesCircle>.98,JSON.stringify(p));assert.equal(p.font,'10px');}
  for(const selector of ['#aiAnalyzeBtn','.patient-secondary-actions','#deletePatientBtn','.flower-toolbar','.flower-footer'])assert.equal(await page.locator(selector).isVisible(),false,selector);
  return g;
}

async function checkFlowerIdentity(page){
  if(await page.locator('[data-flower-expand]').isVisible()){
    const cap=await page.locator('.flower-identity').evaluate(circle=>{
      const stage=circle.closest('.flower-stage').getBoundingClientRect(),r=circle.getBoundingClientRect(),name=circle.querySelector('h1').getBoundingClientRect();
      return {count:circle.children.length,visible:[...circle.children].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.id),fraction:(r.bottom-stage.top)/r.height,nameVisible:name.top>=stage.top&&name.bottom<=r.bottom&&name.left>=r.left&&name.right<=r.right};
    });
    assert.equal(cap.count,4);assert.deepEqual(cap.visible,['flowerPatientName']);assert.ok(cap.fraction>=.25&&cap.fraction<=.33,JSON.stringify(cap));assert.ok(cap.nameVisible,JSON.stringify(cap));
    return;
  }
  const identity=await page.locator('.flower-identity').evaluate(circle=>{
    const r=circle.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,compact=circle.closest('.patient-flower').classList.contains('is-compact');
    const elements=[...circle.children].map(el=>{
      const b=el.getBoundingClientRect(),s=getComputedStyle(el);
      return {key:el.id||el.className,visible:s.display!=='none'&&s.visibility==='visible',
        inside:compact ? b.left>=r.left+1&&b.right<=r.right-1&&b.top>=r.top+1&&b.bottom<=r.bottom-1 : [[b.left,b.top],[b.right,b.top],[b.left,b.bottom],[b.right,b.bottom]].every(([x,y])=>Math.hypot(x-cx,y-cy)<=r.width/2-1),
        left:b.left,right:b.right,top:b.top,bottom:b.bottom};
    });
    const button=circle.querySelector('#aiAnalyzeBtn'),buttonRect=button.getBoundingClientRect(),buttonStyle=getComputedStyle(button),textRange=document.createRange();textRange.selectNodeContents(button);const textRect=textRange.getBoundingClientRect();
    const meta=circle.querySelector('.patient-hero-meta');
    return {elements,compact,metaFits:meta.scrollWidth<=meta.clientWidth+1,
      buttonTextFits:textRect.left>=buttonRect.left+parseFloat(buttonStyle.paddingLeft)-.5&&textRect.right<=buttonRect.right-parseFloat(buttonStyle.paddingRight)+.5,
      nameStyle:getComputedStyle(circle.querySelector('h1')).textOverflow,
      aiText:circle.querySelector('#aiAnalyzeBtn').textContent,
      forbidden:!!circle.querySelector('.flower-complaint,.patient-hero-date,[data-patient-details],.patient-hero-actions')};
  });
  assert.equal(identity.elements.length,4,JSON.stringify(identity));
  for(const el of identity.elements){assert.ok(el.visible,`Identity element is hidden: ${JSON.stringify(identity)}`);assert.ok(el.inside,`Identity element crosses circle: ${JSON.stringify(identity)}`);}
  if(identity.compact){
    for(let i=0;i<identity.elements.length;i++)for(let j=i+1;j<identity.elements.length;j++){
      const a=identity.elements[i],b=identity.elements[j];
      assert.ok(a.right+1<=b.left||b.right+1<=a.left||a.bottom+1<=b.top||b.bottom+1<=a.top,`Compact identity elements overlap: ${JSON.stringify(identity)}`);
    }
  }else for(let i=1;i<identity.elements.length;i++)assert.ok(identity.elements[i].top>=identity.elements[i-1].bottom+3,`Identity elements need space: ${JSON.stringify(identity)}`);
  assert.ok(identity.metaFits,`Age and sex must fit one line: ${JSON.stringify(identity)}`);
  assert.ok(identity.buttonTextFits,`The analysis label must fit with padding: ${JSON.stringify(identity)}`);
  assert.equal(identity.nameStyle,'ellipsis');
  assert.equal(identity.aiText,'Анализ пациента');
  assert.equal(identity.forbidden,false);
}

test('Flower layout geometry: unchanged desktop columns and compact mobile cap',async t=>{
  const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path==='/fixture'){res.setHeader('Content-Type','text/html');res.end(shell);return;}if(!/^\/[a-zA-Z0-9.-]+$/.test(path)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':'text/javascript');res.end(await readFile(new URL(path.slice(1),root)));}catch{res.writeHead(404);res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try {
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    for(const width of [1440,1280,390,320])await t.test(`${width}px`,async()=>{
      const page=await browser.newPage({viewport:{width,height:width>=1280?900:844},isMobile:width<701,hasTouch:width<701,reducedMotion:'reduce'});
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);await install(page);
        for(const mode of ['expanded','compact']) {
          if(mode==='compact')await toggleFlower(page);
          const g=await page.evaluate(()=>{
            const rect=selector=>{const el=document.querySelector(selector);if(!el)return null;const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
            return {flower:rect('.patient-flower'),work:rect('.patient-work-area'),heading:rect('.overview-heading h2'),panel:rect('.patient-secondary-actions'),nav:rect('.flower-navigation'),scroll:document.documentElement.scrollWidth,scrollY,grid:document.querySelector('.patient-workspace')&&getComputedStyle(document.querySelector('.patient-workspace')).display};
          });
          assert.ok(g.work,`${mode}: a real working column is required`);assert.equal(g.grid,'grid');assert.ok(g.scroll<=width,JSON.stringify(g));
          if(width>=1280){
            assert.ok(await page.locator('.patient-facts').isVisible(),'The desktop column must show the full saved patient name and facts');
            assert.equal(await page.locator('.patient-facts h2').textContent(),'Михаил Тестовый');
            assert.ok(g.work.left>=g.flower.right+20,JSON.stringify(g));assert.ok(Math.abs(g.work.top-g.flower.top)<=4,JSON.stringify(g));
            assert.ok(g.heading.left>=g.work.left&&g.heading.right<=g.work.right+1,JSON.stringify(g));
            assert.ok(g.heading.top>=g.work.top&&g.heading.bottom<900,JSON.stringify(g));assert.equal(g.scrollY,0);
          }else if(mode==='compact'){
            assert.ok(g.flower.height<=190,JSON.stringify(g));
            assert.ok(g.work.top>=g.flower.bottom&&g.work.top<=g.flower.bottom+9,JSON.stringify(g));
            assert.equal(await page.locator('.flower-identity').evaluate(el=>getComputedStyle(el).borderRadius),'50%');
            assert.equal(await page.locator('.patient-secondary-actions').isVisible(),false);
          }
          if(mode==='expanded')assert.equal(await page.locator('.flower-identity').evaluate(el=>getComputedStyle(el).borderRadius),'50%');
        }
      } finally {await page.close();}
    });
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
});

test('real patient renderer: responsive flower, navigation, keyboard, reports and schedule',async t=>{
  assert.ok(process.env.CHROMIUM_EXECUTABLE,'Chromium is required');
  const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path==='/fixture'){res.setHeader('Content-Type','text/html');res.end(shell);return;}if(!/^\/[a-zA-Z0-9.-]+$/.test(path)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':'text/javascript');res.end(await readFile(new URL(path.slice(1),root)));}catch{res.writeHead(404);res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const evidence=[];
  try{
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    for(const width of [320,375,390,430])await t.test(`${width}px default mobile cap, real touch targets and live form retention`,async()=>{
      const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
      try{
        await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);await install(page,'normal',false);
        assert.ok(await page.locator('.patient-flower').evaluate(el=>el.classList.contains('is-compact')),'Mobile must start compact');
        const g=await checkMobileCap(page);evidence.push({width,state:'mobile-cap',...g});
        const folder=process.env.FLOWER_SCREENSHOT_DIR;if(folder)await mkdir(folder,{recursive:true});
        if(folder&&[375,390].includes(width))await page.screenshot({path:`${folder}/flower-mobile-compact-${width===390?'new-390':'375'}.png`});
        await page.evaluate(()=>window.originalFlower=document.querySelector('.patient-flower'));
        await page.locator('[data-flower-expand]').tap();
        assert.ok(await page.evaluate(()=>document.querySelector('.patient-flower')===window.originalFlower&&!window.originalFlower.classList.contains('is-compact')));
        await checkFlowerIdentity(page);await checkFlowerSurfaces(page,'expanded');
        for(const selector of ['#aiAnalyzeBtn','.patient-secondary-actions'])assert.ok(await page.locator(selector).isVisible(),selector);
        if(folder&&width===390)await page.screenshot({path:`${folder}/flower-mobile-expanded-after-tap-390.png`});
        await page.locator('[data-flower-toggle]').tap();
        if(width===390){
          await page.locator('[data-flower-expand]').focus();await page.keyboard.press('Enter');
          assert.equal(await page.locator('.patient-flower').evaluate(el=>el.classList.contains('is-compact')),false);
          assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-flower-toggle')),true);
          await page.locator('[data-flower-toggle]').tap();
        }
        const sections=[['overview','.patient-overview'],['assessment','#assessmentForm'],['goals','.goals-workspace'],['sessions','#sessionForm'],['progress','#aiDynamicsBtn'],['media','#mediaForm'],['parent','.parent-specialist']];
        for(const [key,selector] of sections)for(const target of ['.flower-icon','.flower-petal-content>span:not(.flower-active-mark)']){
          const r=await page.locator(`[data-tab="${key}"] ${target}`).boundingBox();await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);
          await page.locator(selector).waitFor();await page.waitForFunction(key=>window.flowerEnvironment.state.tab===key&&!document.querySelector(`[data-tab="${key}"]`).disabled,key);
          assert.equal(await page.locator('[aria-current="page"]').getAttribute('data-tab'),key);
          assert.ok(await page.locator(`[data-tab="${key}"] .flower-petal-compact`).first().evaluate(el=>{const fill=getComputedStyle(el).fill;return fill.includes('flower-active-')||fill==='rgb(160, 230, 216)';}));
          const inactive=await page.locator('.flower-petal:not(.is-active) .flower-petal-compact:not(.flower-petal-rim)').evaluateAll(els=>els.map(el=>getComputedStyle(el).fill));assert.ok(inactive.every(fill=>fill==='rgb(255, 255, 255)'));
        }
        await page.locator('[data-tab="goals"]').tap();await page.locator('#goalFormToggle').click();await page.locator('#goalForm [name="title"]').fill('Несохранённая мобильная цель');
        await page.evaluate(()=>{window.retainedMobileForm=document.getElementById('goalForm');window.retainedMobileField=window.retainedMobileForm.querySelector('[name="title"]');});
        await page.locator('[data-flower-expand]').tap();await page.locator('[data-flower-toggle]').tap();await page.locator('[data-tab="assessment"]').tap();await page.locator('[data-tab="goals"]').tap();
        assert.ok(await page.evaluate(()=>window.retainedMobileForm===document.getElementById('goalForm')&&window.retainedMobileField===document.querySelector('#goalForm [name="title"]')));
        assert.equal(await page.locator('#goalForm [name="title"]').inputValue(),'Несохранённая мобильная цель');await checkMobileCap(page);
        assert.deepEqual(await page.evaluate(()=>window.networkCalls.filter(c=>c.op!=='read')),[]);assert.deepEqual(errors,[]);
      }finally{await page.close();}
    });
    for(const width of [320,350,360,375,390,430,768,1024,1280,1440])await t.test(`${width}px`,async()=>{
      const page=await browser.newPage({viewport:{width,height:width<701?844:900},isMobile:width<701,hasTouch:width<701});const errors=[];page.on('pageerror',e=>errors.push(e.message));
      page.setDefaultTimeout(10000);
      try {
      await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);await install(page);
      const measure=()=>page.evaluate(()=>{const r=el=>{const b=el.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}};return {width:innerWidth,scroll:document.documentElement.scrollWidth,flower:r(document.querySelector('.patient-flower')),stage:r(document.querySelector('.flower-stage')),nav:r(document.querySelector('.flower-navigation')),identity:r(document.querySelector('.flower-identity')),petals:[...document.querySelectorAll('.flower-petal')].map(el=>({key:el.dataset.tab,...r(el),reachable:(()=>{const b=el.getBoundingClientRect();return document.elementFromPoint(b.left+b.width/2,b.top+b.height/2)?.closest('.flower-petal')===el})()}))};});
      const expanded=await measure();evidence.push({width,state:'expanded',...expanded});
      if(process.env.FLOWER_SCREENSHOT_DIR){await mkdir(process.env.FLOWER_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:`${process.env.FLOWER_SCREENSHOT_DIR}/flower-expanded-${width}.png`,fullPage:true});
        const overflow=await page.evaluate(width=>[...document.querySelectorAll('body *')].map(el=>{const r=el.getBoundingClientRect();return {tag:el.tagName,class:el.className?.baseVal??el.className,left:r.left,right:r.right,text:el.textContent.slice(0,40)}}).filter(r=>r.right>width+1||r.left < -1),width);
        await writeFile(`${process.env.FLOWER_SCREENSHOT_DIR}/overflow-${width}.json`,JSON.stringify({expanded,overflow},null,2));}
      assert.ok(expanded.scroll<=width,JSON.stringify(expanded));
      for(const p of expanded.petals){assert.ok(p.left>=-1&&p.right<=width+1,JSON.stringify(p));assert.ok(p.width>=44&&p.height>=44);assert.ok(p.reachable,`Petal occluded: ${JSON.stringify(p)}`);}
      await checkFlowerSurfaces(page,'expanded');
      await checkFlowerIdentity(page);
      if(width===390){
        await toggleFlower(page);await page.waitForTimeout(300);
        assert.equal(await page.evaluate(()=>scrollY),0,'Folding must keep the page in place when its focused control moves');
        await toggleFlower(page);await page.waitForTimeout(300);
        assert.equal(await page.evaluate(()=>scrollY),0,'Expanding must keep the page in place');
        const motion=await page.evaluate(async()=>{
          const stage=document.querySelector('.flower-stage'),petal=document.querySelector('[data-tab="goals"]'),content=petal.querySelector('.flower-petal-content');
          const duration=getComputedStyle(stage).transitionDuration;
          const frames=[],start=performance.now();document.querySelector('[data-flower-toggle]').click();
          await new Promise(resolve=>{const sample=()=>{const a=new DOMMatrix(getComputedStyle(petal).transform),b=new DOMMatrix(getComputedStyle(content).transform);let angle=(Math.atan2(a.b,a.a)+Math.atan2(b.b,b.a))*180/Math.PI;angle=(angle+540)%360-180;frames.push({height:stage.getBoundingClientRect().height,angle});if(performance.now()-start<320)requestAnimationFrame(sample);else resolve();};requestAnimationFrame(sample);});
          return {duration,frames};
        });
        assert.equal(motion.duration,'0.25s');assert.ok(new Set(motion.frames.map(f=>Math.round(f.height))).size>2,'The fold must animate through intermediate heights');
        assert.ok(motion.frames.every(f=>Math.abs(f.angle)<2),JSON.stringify(motion));
        await toggleFlower(page);await page.waitForTimeout(300);
      }
      await page.locator('[data-tab="goals"]').click();await page.locator('#goalFormToggle').waitFor();
      await page.locator('[data-flower-toggle][aria-expanded="false"]').waitFor({state:'attached'});
      // CSS transitions finish before layout assertions; this is a bounded browser wait.
      await page.waitForTimeout(300);
      const compact=await measure();evidence.push({width,state:'compact',...compact});
      await checkFlowerIdentity(page);
      assert.ok(compact.scroll<=width,JSON.stringify(compact));assert.ok(compact.flower.height<=240,JSON.stringify(compact));assert.ok(compact.stage.height<expanded.stage.height*.75);
      assert.equal(await page.locator('.flower-identity').evaluate(el=>getComputedStyle(el).borderRadius),width<=700?'50%':'18px');
      assert.ok(await page.locator('.flower-navigation').evaluate(el=>el.scrollHeight<=el.clientHeight+1),'Compact navigation must fit its allotted height');
      for(const p of compact.petals){
        const button=page.locator(`[data-tab="${p.key}"]`);await button.scrollIntoViewIfNeeded();
        assert.ok(await button.evaluate(el=>{const r=el.getBoundingClientRect(),nav=el.closest('nav').getBoundingClientRect();return r.height>=44&&r.width>=44&&(innerWidth<=700||r.left>=nav.left-1&&r.right<=nav.right+1)&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('.flower-petal')===el;}),`The compact section must be reachable after scrolling: ${p.key}`);
      }
      if(width===1440){await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width,height:900});await page.waitForTimeout(300);}
      assert.equal(await page.locator('[aria-current="page"]').getAttribute('data-tab'),'goals');
      await page.locator('#goalFormToggle').click();await page.locator('[name="title"]').fill('Несохранённая цель');
      await page.evaluate(()=>window.unsavedGoalForm=document.getElementById('goalForm'));
      await toggleFlower(page);await toggleFlower(page);assert.equal(await page.locator('[name="title"]').inputValue(),'Несохранённая цель');
      await page.locator('[data-tab="overview"]').focus();await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.dataset.tab),'parent');
      await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement.dataset.tab),'overview');
      for(const [key,selector]of [['assessment','#assessmentForm'],['sessions','#sessionForm'],['progress','#aiDynamicsBtn'],['media','#mediaForm'],['parent','.parent-specialist'],['overview','.patient-overview']]){
        await page.locator(`[data-tab="${key}"]`).click();await page.locator(selector).waitFor();assert.equal(await page.locator('[aria-current="page"]').getAttribute('data-tab'),key);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${key}: no page overflow at ${width}px`);
        if(width>=1280)assert.ok(await page.locator('#tabContent').evaluate(el=>el.getBoundingClientRect().left>=document.querySelector('.patient-flower').getBoundingClientRect().right+20),`${key}: keep the live form in the right column`);
      }
      await page.locator('[data-tab="goals"]').click();
      assert.equal(await page.locator('#goalForm [name="title"]').inputValue(),'Несохранённая цель');
      assert.ok(await page.evaluate(()=>window.unsavedGoalForm===document.getElementById('goalForm')));
      await page.locator('[data-tab="assessment"]').click();
      await page.locator('#assessmentForm [name="complaint"]').fill('Несохранённая оценка');
      await page.evaluate(()=>window.unsavedAssessment=document.getElementById('assessmentForm'));
      await page.locator('[data-tab="media"]').click();
      await page.locator('[data-tab="assessment"]').click();
      assert.equal(await page.locator('#assessmentForm [name="complaint"]').inputValue(),'Несохранённая оценка');
      assert.ok(await page.evaluate(()=>window.unsavedAssessment===document.getElementById('assessmentForm')));
      await page.locator('[data-tab="overview"]').click();
      await page.locator('[data-overview-report]').click();await page.locator('[data-report-editor]').waitFor({state:'visible'});assert.equal(await page.locator('[data-report-editor] [name="complaint"]').inputValue(),'Трудности с равновесием');
      await page.locator('[data-close-report]').click();
      await page.locator('[data-overview-tab="goals"]').click();await page.locator('#goalFormToggle').waitFor();assert.equal(await page.evaluate(()=>document.activeElement.dataset.tab),'goals');
      await page.locator('[data-tab="overview"]').click();
      await page.locator('[data-overview-appointment]').click();await page.locator('.schedule-dialog').waitFor({state:'visible'});assert.equal(await page.locator('.schedule-dialog [data-search]').inputValue(),'Михаил Тестовый');await page.locator('.schedule-dialog [data-close]').first().click();
      if(width<=700)await toggleFlower(page);
      await page.locator('.flower-support summary').click();await page.locator('#aiHistoryBtn').click();await page.getByText('Сохранённых анализов пока нет.',{exact:true}).waitFor();
      if(width===390){
        await page.evaluate(()=>window.retainedHistory=document.querySelector('.patient-analysis-history'));
        await toggleFlower(page);assert.equal(await page.locator('.patient-analysis-history').isVisible(),false);assert.equal(await page.locator('.patient-secondary-actions').isVisible(),false);
        await toggleFlower(page);assert.ok(await page.locator('.patient-analysis-history').isVisible());assert.ok(await page.evaluate(()=>window.retainedHistory===document.querySelector('.patient-analysis-history')));
      }
      await page.locator('#aiHistoryBtn').click();
      await page.locator('.flower-support summary').click();
      await page.locator('[data-patient-details]').click();await page.locator('.flower-details-dialog').waitFor({state:'visible'});await page.locator('[data-close-details]').click();
      assert.deepEqual(errors,[]);
      const writes=await page.evaluate(()=>window.networkCalls.filter(c=>c.op!=='read'));assert.deepEqual(writes,[],'UI navigation must not mutate clinical data');
      if(process.env.FLOWER_SCREENSHOT_DIR){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${process.env.FLOWER_SCREENSHOT_DIR}/flower-compact-${width}.png`,fullPage:true});}
      } finally {await page.close();}
    });
    for(const width of [320,350,360,390])await t.test(`${width}px identity names and missing facts`,async()=>{
      const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);await install(page);
        for(const name of ['Миша','Александр','Тест','Иванов Иван Иванович','  Михаил\tАнтонов  ','Анна-Мария Петрова','Александрина'.repeat(12),'']) {
          await page.evaluate(async name=>{const env=window.flowerEnvironment;env.p.display_name=name;env.p.date_of_birth=name? '2021-04-12':null;env.p.sex=name?'male':'unspecified';await env.renderPatient();},name);
          await page.locator('[data-overview-report][aria-busy="false"]').waitFor();
          for(const compact of [false,true]) {
            await page.locator('.patient-flower').evaluate((root,compact)=>{if(root.classList.contains('is-compact')!==compact)root.querySelector('[data-flower-toggle]').click();},compact);
            await checkFlowerIdentity(page);
            assert.equal(await page.locator('.flower-identity h1').textContent(),name.trim().split(/\s+/)[0]||'Без имени');
            if(!name)assert.equal(await page.locator('.flower-identity .patient-hero-meta').textContent(),'Возраст — · Пол —');
            assert.equal(await page.evaluate(()=>window.flowerEnvironment.p.display_name),name);
            assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
          }
        }
        assert.deepEqual(await page.evaluate(()=>window.networkCalls.filter(c=>c.op!=='read')),[]);
      } finally {await page.close();}
    });
    for(const variant of ['long','empty','error','session-report','ai','ai-error','assessment','saving'])await t.test(`390px ${variant}`,async()=>{
      const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);await install(page,variant);
      page.setDefaultTimeout(10000);
      assert.equal(await page.locator('.flower-stage').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      if(variant==='error'){assert.match(await page.locator('.overview-appointment').textContent(),/Расписание недоступно/);await page.locator('[data-retry-appointment]').click();}
      if(variant==='empty'){await page.locator('[data-overview-add-goal]').click();await page.locator('#goalForm').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>document.activeElement.name),'title');await page.locator('[data-tab="overview"]').click();await page.locator('[data-overview-appointment]').click();await page.locator('.schedule-dialog').waitFor();assert.equal(await page.locator('.schedule-dialog [data-search]').inputValue(),'Михаил Тестовый');assert.equal(await page.locator('.schedule-dialog [name="price"]').inputValue(),'3500');assert.equal(await page.locator('.schedule-dialog [name="save_tariff"]').isChecked(),false);await page.locator('.schedule-dialog [data-close]').first().click();}
      if(variant==='session-report'){await page.locator('[data-overview-report]').click();await page.locator('[data-parent-session-editor] [name="what_did"]').waitFor();assert.equal(await page.locator('[data-parent-session-editor] [name="what_did"]').inputValue(),'Сохранённый отчёт занятия');assert.equal(await page.locator('[aria-current="page"]').getAttribute('data-tab'),'sessions');assert.equal(await page.evaluate(()=>document.activeElement.name),'what_did');assert.deepEqual(await page.evaluate(()=>window.networkCalls.filter(c=>c.op!=='read')),[]);}
      if(variant==='ai'){
        await page.locator('#aiAnalyzeBtn').click();await page.waitForFunction(()=>document.getElementById('aiAnalyzeBtn').textContent!=='Анализируем…');assert.match(await page.locator('.ai-result-card').textContent(),/Вымышленные данные/,JSON.stringify(errors));assert.ok(await page.locator('.ai-result-card').isVisible());
        await page.evaluate(()=>window.retainedAnalysis=document.querySelector('.ai-result-card'));
        await toggleFlower(page);assert.equal(await page.locator('.ai-result-card').isVisible(),false);assert.equal(await page.locator('.ai-result-toggle').isVisible(),false);assert.equal(await page.locator('#aiAnalyzeBtn').isVisible(),false);
        await toggleFlower(page);assert.ok(await page.locator('.ai-result-card').isVisible());assert.ok(await page.evaluate(()=>window.retainedAnalysis===document.querySelector('.ai-result-card')));
        assert.match(await page.locator('.ai-result-card').textContent(),/Вымышленные данные/);assert.deepEqual(await page.evaluate(()=>window.aiCalls),[['patient_analysis','fictional-child',{},[]]]);assert.deepEqual(await page.evaluate(()=>window.networkCalls.filter(c=>c.op!=='read').map(c=>[c.table,c.op])),[['patients','update'],['ai_analysis_history','insert']]);
      }
      if(variant==='ai-error'){
        await page.locator('#aiAnalyzeBtn').click();
        await page.getByText('Не удалось выполнить анализ ИИ. Попробуйте ещё раз.',{exact:true}).waitFor();
        assert.equal(await page.locator('#aiAnalyzeBtn').isEnabled(),true);await checkFlowerIdentity(page);
        assert.deepEqual(await page.evaluate(()=>window.networkCalls.filter(c=>c.op!=='read')),[]);
        assert.equal(errors.length,1);assert.match(errors[0],/Synthetic AI failure/);errors.length=0;
      }
      if(variant==='assessment'){
        await page.locator('[data-tab="assessment"]').click();
        const form=page.locator('#assessmentForm');
        await form.locator('[name="complaint"]').fill('Вымышленная оценка равновесия');
        const testsSection=form.locator('.section-card:has([name="hine_score"])');
        if(await testsSection.locator('.section-head').getAttribute('aria-expanded')==='false')await testsSection.locator('.section-head').click();
        for(const [name,value]of [['gmfcs','II'],['macs','I'],['cfcs','I'],['edacs','I']])await form.locator(`[name="${name}"]`).selectOption(value);
        await form.locator('[name="hine_score"]').fill('58');await form.locator('[name="gmfm66_score"]').fill('42.5');
        await page.locator('[data-tab="goals"]').click();await toggleFlower(page);await page.locator('[data-tab="assessment"]').click();
        await page.locator('#assessmentSaveBtn').click();await page.getByText('✓ Данные сохранены в облаке',{exact:true}).waitFor();
        assert.deepEqual(await page.evaluate(()=>({complaint:window.flowerEnvironment.state.assessment.complaint,tests:window.flowerEnvironment.state.assessment.structured_data.tests})),{complaint:'Вымышленная оценка равновесия',tests:{gmfcs:'II',macs:'I',cfcs:'I',edacs:'I',hine_score:'58',hine_date:'',gmfm66_score:'42.5',gmfm66_date:'',name:'',result:''}});
        const historySection=form.locator('.section-card:has(#saveStandardizedHistoryBtn)');
        if(await historySection.locator('.section-head').getAttribute('aria-expanded')==='false')await historySection.locator('.section-head').click();
        await historySection.locator('details').evaluate(el=>el.open=true);
        await page.locator('#saveStandardizedHistoryBtn').click();await page.getByText('✓ Добавлено результатов: 6',{exact:true}).waitFor();
        const rows=await page.evaluate(()=>window.networkCalls.find(c=>c.table==='standardized_assessments'&&c.op==='upsert').payload);
        assert.deepEqual(rows.map(r=>[r.scale,r.value_text,r.value_numeric]),[['gmfcs','II',null],['macs','I',null],['cfcs','I',null],['edacs','I',null],['hine',null,58],['gmfm66',null,42.5]]);
        assert.ok(rows.every(r=>r.patient_id==='fictional-child'&&r.therapist_id==='fictional-owner'));
      }
      if(variant==='saving'){
        await page.locator('[data-tab="progress"]').click();assert.ok(await page.getByText('Данных о динамике пока нет.',{exact:true}).isVisible());
        await page.locator('[data-tab="goals"]').click();await page.locator('#goalFormToggle').click();
        await page.locator('#goalForm [name="title"]').fill('Цель с задержкой сохранения');await page.locator('#goalSaveBtn').click();
        await page.waitForFunction(()=>typeof window.finishSyntheticSave==='function');
        await page.locator('[data-tab="assessment"]').click();await page.locator('#assessmentForm [name="complaint"]').fill('Несохранённая оценка');
        await page.evaluate(()=>{window.assessmentDraft=document.getElementById('assessmentForm');window.finishSyntheticSave();});
        await page.waitForFunction(()=>document.getElementById('goalStatus').textContent.includes('Цель сохранена'));
        assert.equal(await page.evaluate(()=>document.getElementById('assessmentForm')===window.assessmentDraft),true);
        assert.equal(await page.locator('#assessmentForm [name="complaint"]').inputValue(),'Несохранённая оценка');
        await page.locator('[data-tab="goals"]').click();assert.equal(await page.locator('#goalSaveBtn').isEnabled(),true);
        assert.ok(await page.locator('.goals-workspace').getByText('Цель с задержкой сохранения',{exact:true}).isVisible());
        await page.locator('#goalFormToggle').click();await page.locator('#goalForm [name="title"]').fill('Ещё не сохранённая цель');
        await page.evaluate(()=>window.goalDraft=document.getElementById('goalForm'));
        await page.locator('[data-tab="sessions"]').click();await page.locator('#sessionForm [name="note"]').fill('Вымышленное занятие');await page.locator('#sessionForm [name="function_changes"]').fill('Вымышленные наблюдения для проверки обновления сводки');await page.locator('#sessionSaveBtn').click();
        await page.waitForFunction(()=>window.networkCalls.some(c=>c.table==='sessions'&&c.op==='insert'));
        await page.locator('[data-tab="assessment"]').click();await page.evaluate(()=>window.finishSyntheticSave());
        await page.waitForFunction(()=>window.flowerEnvironment.state.sessions.length===1);
        await page.waitForTimeout(850);
        assert.equal(await page.evaluate(()=>window.flowerEnvironment.state.tab),'assessment');
        assert.equal(await page.locator('#assessmentForm [name="complaint"]').inputValue(),'Несохранённая оценка');
        await page.locator('[data-tab="sessions"]').click();assert.equal(await page.locator('#sessionSaveBtn').isEnabled(),true);
        await page.locator('[data-tab="progress"]').click();await page.locator('#tabContent .progress-change-entry summary').click();assert.ok(await page.locator('#tabContent').getByText('Вымышленные наблюдения для проверки обновления сводки',{exact:true}).isVisible());
        await page.locator('[data-tab="goals"]').click();assert.equal(await page.evaluate(()=>document.getElementById('goalForm')===window.goalDraft),true);
        assert.equal(await page.locator('#goalForm [name="title"]').inputValue(),'Ещё не сохранённая цель');
      }
      await toggleFlower(page);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await page.close();
    });
    if(process.env.FLOWER_SCREENSHOT_DIR)await writeFile(`${process.env.FLOWER_SCREENSHOT_DIR}/layout-metrics.json`,JSON.stringify(evidence,null,2));
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});
