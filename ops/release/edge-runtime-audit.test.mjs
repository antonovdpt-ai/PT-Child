import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=new URL('../../',import.meta.url).pathname;
const sha=x=>createHash('sha256').update(x).digest('hex');
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'fizira-runtime-audit-'));
 const paths=Object.fromEntries(['base','head','live','functions','bin'].map(n=>[n,join(dir,n)]));
 for(const p of Object.values(paths))await mkdir(p);
 for(const [manifest,sub]of [['frontend-assets.txt',''],['edge-assets.txt','supabase/']]){
  for(const file of (await readFile(join(root,'ops/release',manifest),'utf8')).trim().split('\n')){
   const repo=sub+file,live=sub?join(paths.functions,file.replace(/^functions\//,'')):join(paths.live,file);
   for(const p of [join(paths.base,repo),join(paths.head,repo),live]){await mkdir(join(p,'..'),{recursive:true});await writeFile(p,file==='config.toml'?await readFile(join(root,'supabase/config.toml')):'reviewed '+repo);}
  }
 }
 await mkdir(join(paths.functions,'main'));
 const router='const VERIFY_JWT=Deno.env.get("VERIFY_JWT");\nconst servicePath=`/home/deno/functions/${service_name}`;\nEdgeRuntime.userWorkers.create({servicePath,envVars:Deno.env.toObject()});\n';
 await writeFile(join(paths.functions,'main/index.ts'),router);
 const runtimeFiles={};for(const name of await readdir(paths.functions,{recursive:true,withFileTypes:true})){if(name.isFile()&&name.name!=='config.toml'){const relative=join(name.parentPath,name.name).slice(paths.functions.length+1);runtimeFiles[relative]=sha(await readFile(join(paths.functions,relative)));}}
 const snapshot={containerName:'supabase-edge-functions',running:true,imageId:'sha256:'+ 'a'.repeat(64),imageTag:'supabase/edge-runtime:v1.67.0',process:{path:'edge-runtime',args:['start','--main-service','/home/deno/functions/main']},mounts:[{type:'bind',source:paths.functions,destination:'/home/deno/functions',rw:true}],environment:{VERIFY_JWT:'false',SUPABASE_URL:'http://kong:8000',FIZIRA_ALLOWED_ORIGINS:null},secretPresence:{JWT_SECRET:true,SUPABASE_ANON_KEY:true,SUPABASE_SERVICE_ROLE_KEY:true},compose:{configFiles:[]},router:{containerPath:'/home/deno/functions/main/index.ts',sha256:sha(router)},runtimeFiles};
 const profile={schemaVersion:1,status:'reviewed',mode:'self-hosted-bind-mount',sourceBase:'base',cliConfigPath:join(paths.functions,'config.toml'),reviewEvidence:'synthetic-test-only',snapshot};
 await mkdir(join(paths.head,'ops/release'),{recursive:true});
 await writeFile(join(paths.head,'ops/release/edge-runtime-profile.json'),JSON.stringify(profile));
 const docker=join(paths.bin,'docker');
 const inspect={Name:'/supabase-edge-functions',State:{Running:true},Image:snapshot.imageId,Path:snapshot.process.path,Args:snapshot.process.args,Config:{Image:snapshot.imageTag,Env:['VERIFY_JWT=false','SUPABASE_URL=http://kong:8000','JWT_SECRET=DO_NOT_EMIT_SECRET','SUPABASE_ANON_KEY=DO_NOT_EMIT_ANON','SUPABASE_SERVICE_ROLE_KEY=DO_NOT_EMIT_SERVICE'],Labels:{}},Mounts:snapshot.mounts.map(m=>({Type:m.type,Source:m.source,Destination:m.destination,RW:m.rw}))};
 await writeFile(join(dir,'inspect.json'),JSON.stringify([inspect]));
 await writeFile(docker,'#!/usr/bin/env python3\nimport pathlib,sys\nprint(pathlib.Path('+JSON.stringify(join(dir,'inspect.json'))+').read_text())\n',{mode:0o755});
 const env={...process.env,PATH:paths.bin+':'+process.env.PATH,FIZIRA_BASE_SHA:'base',FIZIRA_PR_SHA:'head',FIZIRA_AUDIT_BASE_DIR:paths.base,FIZIRA_AUDIT_HEAD_DIR:paths.head,FIZIRA_PRODUCTION_APP:paths.live,FIZIRA_PRODUCTION_FUNCTIONS:paths.functions,FIZIRA_PRODUCTION_CONFIG:join(paths.functions,'config.toml'),FIZIRA_AUDIT_SKIP_PUBLIC:'1',FIZIRA_EDGE_REQUIRE_HEAD:'1'};
 const run=()=>spawnSync('bash',['ops/release/audit-production-source.sh'],{cwd:root,env,encoding:'utf8'});
 return {dir,paths,profile,inspect,run};
}
test('missing CLI config still stops without a reviewed exact runtime profile',async()=>{
 const f=await fixture();try{await rm(join(f.paths.functions,'config.toml'));f.profile.status='pending';await writeFile(join(f.paths.head,'ops/release/edge-runtime-profile.json'),JSON.stringify(f.profile));const r=f.run();assert.notEqual(r.status,0);assert.doesNotMatch(r.stdout,/SOURCE_AUDIT_OK/);}finally{await rm(f.dir,{recursive:true,force:true});}
});
test('reviewed bind-mount runtime replaces only the absent CLI packaging config check',async()=>{
 const f=await fixture();try{await rm(join(f.paths.functions,'config.toml'));const r=f.run();assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/REVIEWED_BIND_MOUNT_RUNTIME_MATCH/);assert.match(r.stdout,/SOURCE_AUDIT_OK/);assert.doesNotMatch(r.stdout+r.stderr,/DO_NOT_EMIT/);}finally{await rm(f.dir,{recursive:true,force:true});}
});
test('bind-mount profile does not waive unknown sources, router, runtime settings or config',async()=>{
 for(const kind of ['frontend','edge','router','image','jwt','mount','command','packaging','config-symlink','extra-map']){
  const f=await fixture();try{await rm(join(f.paths.functions,'config.toml'));
   if(kind==='frontend')await writeFile(join(f.paths.live,'app.js'),'unknown');
   if(kind==='edge')await writeFile(join(f.paths.functions,'_shared/parent-pdf.ts'),'unknown');
   if(kind==='router')await writeFile(join(f.paths.functions,'main/index.ts'),'unknown');
   if(kind==='image')f.inspect.Image='sha256:'+'b'.repeat(64);
   if(kind==='jwt')f.inspect.Config.Env[0]='VERIFY_JWT=true';
   if(kind==='mount')f.inspect.Mounts.push({Type:'bind',Source:'/other',Destination:'/home/deno/functions/main',RW:true});
   if(kind==='command')f.inspect.Args.push('--config','/other/config.toml');
   if(kind==='packaging')await writeFile(join(f.paths.head,'supabase/config.toml'),'[functions.generate-parent-report-pdf]\nverify_jwt=false\n');
   if(kind==='config-symlink'){const {symlink}=await import('node:fs/promises');await symlink('/does-not-exist',join(f.paths.functions,'config.toml'));}
   if(kind==='extra-map')await writeFile(join(f.paths.functions,'deno.json'),'{}');
   await writeFile(join(f.dir,'inspect.json'),JSON.stringify([f.inspect]));const r=f.run();assert.notEqual(r.status,0,kind+' '+r.stdout+r.stderr);assert.doesNotMatch(r.stdout,/SOURCE_AUDIT_OK/,kind);
  }finally{await rm(f.dir,{recursive:true,force:true});}
 }
});
test('runtime collector emits actual startup evidence without secret values or a ready verdict',async()=>{
 const f=await fixture();try{
  await rm(join(f.paths.functions,'config.toml'));
  const r=spawnSync('python3',['-B','ops/release/edge-runtime-audit.py','--collect','--functions',f.paths.functions],{cwd:root,env:{...process.env,PATH:f.paths.bin+':'+process.env.PATH},encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+r.stderr);assert.doesNotMatch(r.stdout+r.stderr,/DO_NOT_EMIT/);
  const result=JSON.parse(r.stdout);assert.equal(result.publicationReady,false);assert.equal(result.edgeRuntimeGate,'NOT_ATTESTED_METADATA_ONLY');assert.equal(result.sqlVerificationGate,'NOT_ATTESTED');assert.deepEqual(result.snapshot,f.profile.snapshot);assert.match(result.routerSource,/userWorkers\.create/);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('workflow ships the verifier and retains all independent evidence requirements',async()=>{
 const workflow=await readFile(join(root,'.github/workflows/deploy-fizira-frontend.yml'),'utf8');
 assert.match(workflow,/tar -czf release-tools\.tar\.gz[^\n]*ops\/release\/edge-runtime-audit\.py/);
 assert.equal((workflow.match(/FIZIRA_EDGE_REQUIRE_HEAD=1/g)||[]).length,2);
 const validator=await readFile(join(root,'ops/release/verify-release-evidence.mjs'),'utf8');
 for(const gate of ['backup:true','sqlVerification:true','edgeRuntime:true','syntheticIsolatedTarget:true','manualDesktopMobile:true','ancestryReconciled:true'])assert.ok(validator.includes(gate),gate);
});
test('all mounted router dependencies and per-function configuration are pinned',async()=>{
 const f=await fixture();try{
  await rm(join(f.paths.functions,'config.toml'));
  await writeFile(join(f.paths.functions,'main/router-config.ts'),'export const limit=150;');
  await writeFile(join(f.paths.functions,'generate-parent-report-pdf/import_map.json'),'{"imports":{}}');
  const collect=()=>spawnSync('python3',['-B','ops/release/edge-runtime-audit.py','--collect','--functions',f.paths.functions],{cwd:root,env:{...process.env,PATH:f.paths.bin+':'+process.env.PATH},encoding:'utf8'});
  let r=collect();assert.equal(r.status,0,r.stdout);const before=JSON.parse(r.stdout).snapshot;
  await writeFile(join(f.paths.functions,'main/router-config.ts'),'export const limit=999;');
  r=collect();assert.equal(r.status,0,r.stdout);assert.notDeepEqual(JSON.parse(r.stdout).snapshot,before,'router dependency drift must change evidence');
  await writeFile(join(f.paths.functions,'main/router-config.ts'),'export const limit=150;');
  await writeFile(join(f.paths.functions,'generate-parent-report-pdf/import_map.json'),'{"imports":{"pdf-lib":"unreviewed"}}');
  r=collect();assert.equal(r.status,0,r.stdout);assert.notDeepEqual(JSON.parse(r.stdout).snapshot,before,'per-function import map drift must change evidence');
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('collector fails closed when escaped secret values appear in metadata',async()=>{
 for(const value of ['password-with-"quote','password-with-\\slash','password-with-\nnewline','пароль-с-юникодом']){
  const f=await fixture();try{
   f.inspect.Config.Env.push('DB_PASSWORD='+value);f.inspect.Args.push('--unexpected',value);
   await writeFile(join(f.dir,'inspect.json'),JSON.stringify([f.inspect]));
   const r=spawnSync('python3',['-B','ops/release/edge-runtime-audit.py','--collect','--functions',f.paths.functions],{cwd:root,env:{...process.env,PATH:f.paths.bin+':'+process.env.PATH},encoding:'utf8'});
   assert.notEqual(r.status,0,'secret-bearing metadata must stop before serialization');assert.doesNotMatch(r.stdout,/password-with|пароль-с/);
  }finally{await rm(f.dir,{recursive:true,force:true});}
 }
});
