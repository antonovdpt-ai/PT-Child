import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=new URL('../../',import.meta.url).pathname;
const baseline='f9f42204d907195ed04f09cd47f8ad563b2078fb';
const helper='ops/release/ensure-parent-portal-baseline.sh';
const subprocessEnv={...process.env,GIT_TERMINAL_PROMPT:'0'};
// Node's internal child-test context would suppress a nested --test runner.
delete subprocessEnv.NODE_TEST_CONTEXT;
const run=(cmd,args,cwd)=>spawnSync(cmd,args,{cwd,encoding:'utf8',timeout:30000,env:subprocessEnv});

test('every CI test caller provisions and validates the reviewed baseline before regression tests',async()=>{
 const callers=[];
 for(const file of await readdir(join(root,'.github/workflows'))){
  const workflow=await readFile(join(root,'.github/workflows',file),'utf8');
  const tests=workflow.search(/npm test|node --test/);
  if(tests<0)continue;
  callers.push(file);
  const preflight=workflow.indexOf(`bash ${helper}`);
  assert.ok(preflight>workflow.indexOf('actions/checkout@v4')&&preflight<tests,`${file}: required baseline preflight before tests`);
 }
 assert.deepEqual(callers.sort(),['deploy-fizira-frontend.yml','deploy-parent-ux.yml','frontend-tests.yml','release-safety-tests.yml']);
});

test('fresh local shallow checkout fails without baseline, provisions pinned snapshot, passes current URLs and rejects stale v6',async(t)=>{
 const temp=await mkdtemp(join(tmpdir(),'parent-ci-baseline-')),clone=join(temp,'checkout');
 try {
  const cloned=run('git',['clone','--depth=1','--no-tags','--single-branch',pathToFileURL(root).href,clone],root);
  assert.equal(cloned.status,0,cloned.stdout+cloned.stderr);
  assert.notEqual(run('git',['cat-file','-e',`${baseline}^{commit}`],clone).status,0,'fresh one-commit checkout lacks baseline');
  // Copy current uncommitted review changes so the local probe exercises this
  // working tree, not only the previous commit copied by Git.
  await writeFile(join(clone,'ops/release/parent-portal-release.test.mjs'),await readFile(join(root,'ops/release/parent-portal-release.test.mjs')));
  const cache=()=>run(process.execPath,['--test','--test-name-pattern=changed transitive frontend','ops/release/parent-portal-release.test.mjs'],clone);
  const absent=cache();assert.notEqual(absent.status,0,absent.stdout+absent.stderr);assert.match(absent.stdout,/reviewed baseline snapshot must be available/);assert.match(absent.stdout,/tests 1/);assert.match(absent.stdout,/fail 1/);
  t.diagnostic(`fresh depth-1 cache audit: tests1/pass0/fail1, exit${absent.status}`);
  await mkdir(join(clone,'ops/release'),{recursive:true});
  await writeFile(join(clone,helper),await readFile(join(root,helper)));
  const provision=run('bash',[helper],clone);
  assert.equal(provision.status,0,provision.stdout+provision.stderr);
  assert.equal(run('git',['rev-parse','--verify',`${baseline}^{commit}`],clone).stdout.trim(),baseline);
  const positive=cache();assert.equal(positive.status,0,positive.stdout+positive.stderr);assert.match(positive.stdout,/tests 1/);assert.match(positive.stdout,/pass 1/);
  await writeFile(join(clone,'app.js'),(await readFile(join(clone,'app.js'),'utf8')).replace('./cabinet.js?v=7','./cabinet.js?v=6'));
  const stale=cache();assert.notEqual(stale.status,0);assert.match(stale.stdout,/baseline URL .*cabinet\.js\?v=6/);assert.match(stale.stdout,/tests 1/);assert.match(stale.stdout,/fail 1/);
  t.diagnostic(`pinned provisioning: current audit tests1/pass1/fail0 exit${positive.status}; stale-v6 audit tests1/pass0/fail1 exit${stale.status}`);
  // Idempotent provisioning validates the pinned object; an unavailable origin
  // must not turn absent baseline into a successful no-op.
  assert.equal(run('bash',[helper],clone).status,0);
  const missing=join(temp,'missing');assert.equal(run('git',['clone','--depth=1','--no-tags','--single-branch',pathToFileURL(root).href,missing],root).status,0);
  await writeFile(join(missing,helper),await readFile(join(root,helper)));
  assert.equal(run('git',['remote','set-url','origin',join(temp,'absent-repository')],missing).status,0);
  assert.notEqual(run('bash',[helper],missing).status,0,'failed baseline provisioning must STOP');
 }finally{await rm(temp,{recursive:true,force:true});}
});
