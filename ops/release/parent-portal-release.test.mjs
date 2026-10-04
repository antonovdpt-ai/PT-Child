import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=new URL('../../',import.meta.url).pathname;
const read=p=>readFile(join(root,p),'utf8');
const assets=['parent.html','parent.js','parent.css','parent-domain.mjs','parent-specialist.js','role-gate.mjs','cabinet.js','schedule-editor.js'];
test('release packages every portal dependency and checks independent runtime evidence',async()=>{
 const manifest=await read('ops/release/frontend-assets.txt'),workflow=await read('.github/workflows/deploy-fizira-frontend.yml');
 for(const asset of assets)assert.ok(manifest.split('\n').includes(asset),asset);
 for(const gate of ['FIZIRA_BASE_SHA','FIZIRA_PR_SHA','audit-production-source.sh','release-evidence.json','verify-release-evidence.mjs','activate-frontend.sh','postactivation'])assert.ok(workflow.includes(gate),gate);
 for(const fn of ['create-parent-invitation','resend-parent-invitation','revoke-parent-access','generate-parent-report-pdf','parent-report-file'])assert.ok(workflow.includes(`${fn}/index.ts`),fn);
 assert.doesNotMatch(workflow,/supabase (?:db push|functions deploy)/);
});
test('source audit distinguishes reviewed new assets, exact head, and unknown live bytes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'parent-audit-'));
 try {
  for(const sub of ['base','head','live','functions'])await mkdir(join(dir,sub));
  const manifests=await Promise.all(['ops/release/frontend-assets.txt','ops/release/edge-assets.txt'].map(read));
  for(const [i,manifest] of manifests.entries())for(const name of manifest.trim().split('\n')){
   const repo=i?'supabase/'+name:name,live=i?name.replace(/^functions\//,''):name;
   await mkdir(join(dir,'head',repo,'..'),{recursive:true});await writeFile(join(dir,'head',repo),'reviewed head');
   if(!repo.includes('parent')&&!repo.includes('role-gate')&&!repo.includes('fonts/')&&!repo.endsWith('config.toml')){
    await mkdir(join(dir,'base',repo,'..'),{recursive:true});await writeFile(join(dir,'base',repo),'reviewed base');
    await mkdir(join(dir,i?'functions':'live',live,'..'),{recursive:true});await writeFile(join(dir,i?'functions':'live',live),'reviewed base');
   }
  }
  const env={...process.env,FIZIRA_BASE_SHA:'base',FIZIRA_PR_SHA:'head',FIZIRA_AUDIT_BASE_DIR:join(dir,'base'),FIZIRA_AUDIT_HEAD_DIR:join(dir,'head'),FIZIRA_PRODUCTION_APP:join(dir,'live'),FIZIRA_PRODUCTION_FUNCTIONS:join(dir,'functions'),FIZIRA_PRODUCTION_CONFIG:join(dir,'functions','config.toml'),FIZIRA_AUDIT_SKIP_PUBLIC:'1'};
  const run=mode=>spawnSync('bash',['ops/release/audit-production-source.sh'],{cwd:root,env:{...env,FIZIRA_AUDIT_MODE:mode},encoding:'utf8'});
  let r=run('preactivation');assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/APPROVED_NEW_ASSET_ABSENT/);
  const strict=spawnSync('bash',['ops/release/audit-production-source.sh'],{cwd:root,env:{...env,FIZIRA_AUDIT_MODE:'preactivation',FIZIRA_EDGE_REQUIRE_HEAD:'1'},encoding:'utf8'});assert.notEqual(strict.status,0,'frontend preflight requires Edge exact reviewed head');
  r=run('postactivation');assert.notEqual(r.status,0);assert.match(r.stdout,/STOP/);
  await writeFile(join(dir,'live','parent.js'),'unknown newer live');r=run('preactivation');assert.notEqual(r.status,0);assert.match(r.stdout,/UNKNOWN_LIVE__STOP/);
  for(const [i,manifest]of manifests.entries())for(const name of manifest.trim().split('\n')){const live=i?name.replace(/^functions\//,''):name;await mkdir(join(dir,i?'functions':'live',live,'..'),{recursive:true});await writeFile(join(dir,i?'functions':'live',live),'reviewed head');}
  r=run('postactivation');assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/SOURCE_AUDIT_OK/);
  await rm(join(dir,'live','app.js'));r=run('preactivation');assert.notEqual(r.status,0,'existing files cannot be missing');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('first activation backups absent files and rollback preserves unknown newer bytes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'parent-release-'));
 try{
  for(const sub of ['live','stage','backup'])await mkdir(join(dir,sub));
  const all=(await read('ops/release/frontend-assets.txt')).trim().split('\n');
  for(const file of all){await writeFile(join(dir,'stage',file),'head '+file);if(!assets.includes(file))await writeFile(join(dir,'live',file),'old '+file);}
  const run=mode=>spawnSync('bash',['ops/release/activate-frontend.sh',mode,join(dir,'live'),join(dir,'stage'),join(dir,'backup')],{cwd:root,encoding:'utf8'});
  let r=run('activate');assert.equal(r.status,0,r.stderr);assert.match(await readFile(join(dir,'backup','before.tsv'),'utf8'),/parent.js\tABSENT/);
  await writeFile(join(dir,'live','parent.js'),'newer');r=run('rollback');assert.notEqual(r.status,0);assert.equal(await readFile(join(dir,'live','index.html'),'utf8'),'head index.html','preflight before any rollback mutation');
  await writeFile(join(dir,'live','parent.js'),'head parent.js');r=run('rollback');assert.equal(r.status,0,r.stderr);
  for(const file of all)await writeFile(join(dir,'stage',file),'second '+file);r=run('activate');assert.notEqual(r.status,0,'never reuse invocation backup');
  await assert.rejects(readFile(join(dir,'live','parent.js')),/ENOENT/);assert.equal(await readFile(join(dir,'live','index.html'),'utf8'),'old index.html');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('release evidence binds reviewed SHA and completed separate runtime gates',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'parent-evidence-'));try{
 const file=join(dir,'evidence.json'),script=join(root,'ops/release/verify-release-evidence.mjs');
 const run=()=>spawnSync(process.execPath,[script,file,'head','base'],{encoding:'utf8'});
 await writeFile(file,JSON.stringify({head:'head',base:'base',target:'production',sourceAudit:'preactivation',backup:true,migrations:'008-012',sqlVerification:true,edgeRuntime:true,syntheticIsolatedTarget:true,manualDesktopMobile:true,ancestryReconciled:true}));
 assert.equal(run().status,0);for(const field of ['edgeRuntime','sqlVerification','syntheticIsolatedTarget','manualDesktopMobile','ancestryReconciled']){const e=JSON.parse(await readFile(file));e[field]=false;await writeFile(file,JSON.stringify(e));assert.notEqual(run().status,0,field);e[field]=true;await writeFile(file,JSON.stringify(e));}
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('runbook documents migrations through012, independent Edge and disposable-target cleanup',async()=>{
 const doc=await read('ops/parent-portal/README.md');for(const term of ['008 → 009 → 010 → 011 → 012','SMTP','redirect','immutable','disposal','desktop','mobile','Storage','rollback','synthetic-parent-portal-test'])assert.ok(doc.includes(term),term);
});

test('changed transitive frontend dependencies never reuse baseline cache URLs and entry markers agree',async()=>{
 const baseline='f9f42204d907195ed04f09cd47f8ad563b2078fb';
 assert.equal(spawnSync('git',['cat-file','-e',`${baseline}^{commit}`],{cwd:root}).status,0,'reviewed baseline snapshot must be available');
 const listed=(await read('ops/release/frontend-assets.txt')).trim().split('\n');
 const changed=new Set();
 for(const file of listed){
  const old=spawnSync('git',['show',`${baseline}:${file}`],{cwd:root});
  if(old.status===0&&!old.stdout.equals(await readFile(join(root,file))))changed.add(file);
 }
 const urls=text=>[...text.matchAll(/(?:\bfrom\s*['"]|\bimport\s*\(\s*['"]|\b(?:src|href)\s*=\s*['"])([^'"\s]+)['"]/g)].map(m=>m[1]).filter(u=>!u.includes('://')&&!u.startsWith('#'));
 const importers=listed.filter(f=>/\.(?:m?js|html)$/.test(f));
 const resolve=(url,importer)=>new URL(url,`https://cache.fixture/${importer}`);
 const baselineURLs=new Set();
 for(const importer of importers){
  const old=spawnSync('git',['show',`${baseline}:${importer}`],{cwd:root,encoding:'utf8'});
  if(old.status===0)for(const url of urls(old.stdout))baselineURLs.add(resolve(url,importer).href);
 }
 const errors=[];
 for(const importer of importers)for(const url of urls(await read(importer))){
  const resolved=resolve(url,importer),dependency=resolved.pathname.slice(1);
  if(changed.has(dependency)&&baselineURLs.has(resolved.href))errors.push(`${importer} requests changed ${dependency} with baseline URL ${url}`);
 }
 assert.deepEqual(errors,[]);
 const index=await read('index.html'),parent=await read('parent.html');
 const css=html=>html.match(/href="styles\.css\?v=([^"]+)"/)[1];
 assert.equal(css(parent),css(index),'shared stylesheet cache identity');
 assert.equal(index.match(/src="app\.js\?v=([^"]+)"/)[1],css(index),'app/index stylesheet markers advance together');
});
