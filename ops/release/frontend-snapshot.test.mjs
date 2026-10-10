import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat,symlink,chmod,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=new URL('../../',import.meta.url).pathname;
const sha=b=>createHash('sha256').update(b).digest('hex');
const assets=(await readFile(join(root,'ops/release/frontend-assets.txt'),'utf8')).trim().split('\n');
const added=['patient-flower.css','patient-flower.mjs','patient-overview.mjs'];
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'fizira-full-snapshot-'));
 const live=join(dir,'live'),stage=join(dir,'stage'),backup=join(dir,'backup');
 await mkdir(live);await mkdir(stage);
 for(const f of assets){if(!added.includes(f))await writeFile(join(live,f),'old '+f);await writeFile(join(stage,f),added.includes(f)||['app.js','index.html'].includes(f)?'new '+f:'old '+f);}
 await mkdir(join(live,'extra'));await mkdir(join(live,'empty'));
 await writeFile(join(live,'extra/legacy.svg'),'<svg>existing extra static asset</svg>',{mode:0o640});
 const run=mode=>spawnSync('bash',['ops/release/activate-frontend.sh',mode,live,stage,backup],{cwd:root,encoding:'utf8'});
 const verify=(...args)=>spawnSync('python3',['-B','ops/release/frontend-snapshot.py','verify','--backup',backup,'--assets',join(root,'ops/release/frontend-assets.txt'),...args],{cwd:root,encoding:'utf8'});
 return {dir,live,stage,backup,run,verify};
}
test('snapshot mode copies the entire frontend and leaves live and staged files untouched',async()=>{
 const f=await fixture();try{
  const prior=await stat(join(f.live,'app.js')),extra=await stat(join(f.live,'extra/legacy.svg'));
  const r=f.run('snapshot');assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/SNAPSHOT_CREATED_NO_LIVE_CHANGES/);
  const manifest=JSON.parse(await readFile(join(f.backup,'snapshot.json'),'utf8'));
  assert.equal(Object.keys(manifest.files).length,19);assert.ok(manifest.directories.includes('empty'));
  assert.equal(manifest.files['extra/legacy.svg'].sha256,sha(await readFile(join(f.live,'extra/legacy.svg'))));
  assert.equal((await stat(join(f.backup,'files/extra/legacy.svg'))).mode & 0o7777,extra.mode & 0o7777);
  assert.equal((await stat(f.backup)).mode & 0o777,0o700);
  assert.equal((await stat(join(f.live,'app.js'))).ino,prior.ino);assert.equal((await stat(join(f.live,'app.js'))).mtimeMs,prior.mtimeMs);
  assert.equal(await readFile(join(f.stage,'app.js'),'utf8'),'new app.js');
  const before=await readFile(join(f.backup,'before.tsv'),'utf8');for(const name of added)assert.ok(before.includes(name+'\tABSENT'));
  const v=f.verify();assert.equal(v.status,0,v.stdout+v.stderr);assert.match(v.stdout,/FRONTEND_SNAPSHOT_VERIFIED/);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('snapshot integrity refuses corrupted copies, altered manifests and missing full-tree files',async()=>{
 for(const kind of ['copy','manifest','missing']){
  const f=await fixture();try{
   let r=f.run('snapshot');assert.equal(r.status,0,r.stdout+r.stderr);
   if(kind==='copy')await writeFile(join(f.backup,'files/extra/legacy.svg'),'corrupt');
   if(kind==='manifest')await writeFile(join(f.backup,'before.tsv'),'app.js\tABSENT\n');
   if(kind==='missing')await rm(join(f.backup,'files/extra/legacy.svg'));
   r=f.verify();assert.notEqual(r.status,0,kind);assert.equal(await readFile(join(f.live,'app.js'),'utf8'),'old app.js');
  }finally{await rm(f.dir,{recursive:true,force:true});}
 }
});
test('operator-pinned SHA-256 must match the snapshot manifest',async()=>{
 const f=await fixture();try{
  let r=f.run('snapshot');assert.equal(r.status,0,r.stdout+r.stderr);
  const hash=sha(await readFile(join(f.backup,'manifest.sha256')));
  assert.equal(f.verify('--expected-manifest-sha256',hash).status,0);
  assert.notEqual(f.verify('--expected-manifest-sha256','0'.repeat(64)).status,0);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('activation changes only reviewed delta files and verified rollback restores their prior state',async()=>{
 const f=await fixture();try{
  const prior=await stat(join(f.live,'styles.css'));
  let r=f.run('activate');assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal((await stat(join(f.live,'styles.css'))).ino,prior.ino,'identical dependencies must not be replaced');
  assert.equal(await readFile(join(f.live,'app.js'),'utf8'),'new app.js');
  assert.equal(await readFile(join(f.live,'extra/legacy.svg'),'utf8'),'<svg>existing extra static asset</svg>');
  r=f.run('rollback');assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(await readFile(join(f.live,'app.js'),'utf8'),'old app.js');for(const name of added)await assert.rejects(stat(join(f.live,name)),{code:'ENOENT'});
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('rollback validates the full copy before changing any live file',async()=>{
 const f=await fixture();try{
  let r=f.run('activate');assert.equal(r.status,0,r.stdout+r.stderr);
  await writeFile(join(f.backup,'files/extra/legacy.svg'),'corrupt');
  r=f.run('rollback');assert.notEqual(r.status,0);assert.equal(await readFile(join(f.live,'app.js'),'utf8'),'new app.js');
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('snapshot refuses symlinks, existing partial snapshots and a backup inside live tree',async()=>{
 for(const kind of ['symlink','partial','nested']){
  const f=await fixture();try{
   if(kind==='symlink')await symlink(join(f.stage,'app.js'),join(f.live,'extra/link'));
   if(kind==='partial'){await mkdir(f.backup);await writeFile(join(f.backup,'partial'),'incomplete');}
   const backup=kind==='nested'?join(f.live,'backup'):f.backup;
   const r=spawnSync('bash',['ops/release/activate-frontend.sh','snapshot',f.live,f.stage,backup],{cwd:root,encoding:'utf8'});
   assert.notEqual(r.status,0,kind);assert.equal(await readFile(join(f.live,'app.js'),'utf8'),'old app.js');
  }finally{await rm(f.dir,{recursive:true,force:true});}
 }
});
test('complete snapshot preserves and verifies directory metadata',async()=>{
 const f=await fixture();try{
  await chmod(join(f.live,'extra'),0o750);
  const before=await stat(join(f.live,'extra'));
  let r=f.run('snapshot');assert.equal(r.status,0,r.stdout+r.stderr);
  const copied=await stat(join(f.backup,'files/extra'));
  assert.equal(copied.mode & 0o7777,before.mode & 0o7777);assert.equal(copied.uid,before.uid);assert.equal(copied.gid,before.gid);assert.equal(copied.mtimeMs,before.mtimeMs);
  await chmod(join(f.backup,'files/extra'),0o777);r=f.verify();assert.notEqual(r.status,0,'directory metadata corruption must stop verification');
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('rollback refuses a symlink target directory without changing the underlying live tree',async()=>{
 const f=await fixture();try{
  assert.equal(f.run('activate').status,0);const link=join(f.dir,'live-link');await symlink(f.live,link);
  const r=spawnSync('bash',['ops/release/activate-frontend.sh','rollback',link,f.stage,f.backup],{cwd:root,encoding:'utf8'});
  assert.notEqual(r.status,0);assert.equal(await readFile(join(f.live,'app.js'),'utf8'),'new app.js');
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('rollback never follows a planted predictable temporary-file symlink',async()=>{
 const f=await fixture();try{
  assert.equal(f.run('activate').status,0);
  const outside=join(f.dir,'outside.txt');await writeFile(outside,'outside sentinel');await symlink(outside,join(f.live,'app.js.rollback'));
  const r=f.run('rollback');assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(await readFile(outside,'utf8'),'outside sentinel');assert.equal((await lstat(join(f.live,'app.js'))).isSymbolicLink(),false);
  assert.equal(await readFile(join(f.live,'app.js'),'utf8'),'old app.js');
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('a staged-file race cannot publish unverified bytes or prevent guarded recovery',async()=>{
 const f=await fixture();try{
  const bin=join(f.dir,'bin');await mkdir(bin);
  // Inject exactly where the old activator trusted a previously hashed path.
  await writeFile(join(bin,'mv'),`#!/usr/bin/env python3\nimport os,sys\nif sys.argv[-2].endswith('/stage/app.js'):\n open(sys.argv[-2],'w').write('raced corrupt bytes')\nos.execv('/bin/mv',['/bin/mv',*sys.argv[1:]])\n`,{mode:0o755});
  const r=spawnSync('bash',['ops/release/activate-frontend.sh','activate',f.live,f.stage,f.backup],{cwd:root,env:{...process.env,PATH:bin+':'+process.env.PATH},encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(await readFile(join(f.live,'app.js'),'utf8'),'new app.js');assert.equal(f.run('rollback').status,0);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('a source symlink introduced after inventory is refused without dereferencing the copied link',async()=>{
 const f=await fixture();try{
  const script=`import importlib.util,json,pathlib,os,stat\ns=importlib.util.spec_from_file_location('snapshot',${JSON.stringify(join(root,'ops/release/frontend-snapshot.py'))})\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nlive=pathlib.Path(${JSON.stringify(f.live)});backup=pathlib.Path(${JSON.stringify(f.backup)})\noutside=live.parent/'outside.txt';outside.write_text('outside sentinel')\nold_inventory=m.inventory\nflag=[False];followed=[]\ndef inventory(p):\n result=old_inventory(p)\n if pathlib.Path(p)==live and not flag[0]:\n  flag[0]=True;(live/'app.js').unlink();(live/'app.js').symlink_to(outside)\n return result\nm.inventory=inventory\nold_stat=pathlib.Path.stat\ndef checked_stat(p,*a,**kw):\n if str(p).startswith(str(backup/'files')) and stat.S_ISLNK(os.lstat(p).st_mode) and kw.get('follow_symlinks',True):followed.append(str(p))\n return old_stat(p,*a,**kw)\npathlib.Path.stat=checked_stat\ntry:m.create(live,pathlib.Path(${JSON.stringify(f.stage)}),backup,m.assets(${JSON.stringify(join(root,'ops/release/frontend-assets.txt'))}));state='UNEXPECTED_SUCCESS'\nexcept (ValueError,OSError):state='STOP'\nprint(json.dumps({'state':state,'followed':followed,'outside':outside.read_text()}))\n`;
  const r=spawnSync('python3',['-B','-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  const result=JSON.parse(r.stdout);assert.equal(result.state,'STOP');assert.deepEqual(result.followed,[]);assert.equal(result.outside,'outside sentinel');
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('partial fd-based activation stays within known hashes and can be rolled back',async()=>{
 const f=await fixture();try{
  assert.equal(f.run('snapshot').status,0);
  const script=`import importlib.util,pathlib,json,os\ns=importlib.util.spec_from_file_location('snapshot',${JSON.stringify(join(root,'ops/release/frontend-snapshot.py'))});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nlive=pathlib.Path(${JSON.stringify(f.live)});stage=pathlib.Path(${JSON.stringify(f.stage)});backup=pathlib.Path(${JSON.stringify(f.backup)});names=m.assets(${JSON.stringify(join(root,'ops/release/frontend-assets.txt'))})\noriginal=m.os.replace;count=[0]\ndef replace(*a,**kw):\n count[0]+=1\n if count[0]==4:raise OSError('injected fourth replacement failure')\n return original(*a,**kw)\nm.os.replace=replace\ntry:m.mutate('activate',live,stage,backup,names);failed=False\nexcept OSError:failed=True\nm.os.replace=original\nresult=m.mutate('rollback',live,None,backup,names);print(json.dumps({'failed':failed,**result}))\n`;
  const r=spawnSync('python3',['-B','-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).failed,true);
  assert.equal(await readFile(join(f.live,'app.js'),'utf8'),'old app.js');for(const name of added)await assert.rejects(stat(join(f.live,name)),{code:'ENOENT'});
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
