import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const baseline='7566dc412e4918b1ea3f65831e3c9f024545b65a';
const release='2173a05341d40baa4285732c90a4686a3b189919';
const assets=readFileSync('ops/release/frontend-assets.txt','utf8').trim().split('\n');
const changed=['app.js','parent-specialist.js','styles.css','parent.html','index.html'];
function bytes(ref,file){const r=spawnSync('git',['show',`${ref}:${file}`]);assert.equal(r.status,0);return r.stdout;}
function fixture(t){const root=mkdtempSync(join(tmpdir(),'parent-ux-'));t.after(()=>rmSync(root,{recursive:true,force:true})); const target=join(root,'live'),payload=join(root,'payload'),backup=join(root,'backup');mkdirSync(target);mkdirSync(payload);for(const f of assets)writeFileSync(join(target,f),bytes(baseline,f));for(const f of changed)writeFileSync(join(payload,f),bytes(release,f));return {root,target,payload,backup};}
function run(f,env=process.env){const r=spawnSync('bash',['ops/release/activate-parent-ux.sh',f.target,f.payload,f.backup],{encoding:'utf8',env});assert.notEqual(r.status,127,'activation script must run');return r;}
function untouched(f){for(const file of assets)assert.deepEqual(readFileSync(join(f.target,file)),bytes(baseline,file),file);}
test('activates exactly five reviewed files and preserves baseline backup',t=>{const f=fixture(t);const r=run(f);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/PARENT_UX_ACTIVATION_OK/);for(const file of assets)assert.deepEqual(readFileSync(join(f.target,file)),bytes(release,file),file);for(const file of changed)assert.deepEqual(readFileSync(join(f.backup,'files',file)),bytes(baseline,file));assert.equal(existsSync(join(f.backup,'files','parent.js')),false);});
test('unknown production drift rejects before any changed file is replaced',t=>{const f=fixture(t);writeFileSync(join(f.target,'parent.js'),'unexpected production change');const r=run(f);assert.notEqual(r.status,0);for(const file of changed)assert.deepEqual(readFileSync(join(f.target,file)),bytes(baseline,file));assert.equal(existsSync(f.backup),false);});
test('corrupt upload rejects before mutation',t=>{const f=fixture(t);writeFileSync(join(f.payload,'app.js'),'corrupt');assert.notEqual(run(f).status,0);untouched(f);assert.equal(existsSync(f.backup),false);});
test('existing backup is not overwritten',t=>{const f=fixture(t);mkdirSync(f.backup);writeFileSync(join(f.backup,'sentinel'),'keep');assert.notEqual(run(f).status,0);untouched(f);assert.equal(readFileSync(join(f.backup,'sentinel'),'utf8'),'keep');});
test('already active release verifies without creating another backup',t=>{const f=fixture(t);assert.equal(run(f).status,0);const original=readFileSync(join(f.backup,'before.sha256'));const r=run(f);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/PARENT_UX_ALREADY_ACTIVE/);assert.deepEqual(readFileSync(join(f.backup,'before.sha256')),original);});
test('live symlinks reject before mutation',t=>{const f=fixture(t);rmSync(join(f.target,'app.js'));writeFileSync(join(f.root,'outside.js'),bytes(baseline,'app.js'));symlinkSync(join(f.root,'outside.js'),join(f.target,'app.js'));assert.notEqual(run(f).status,0);assert.equal(existsSync(f.backup),false);});
test('payload symlinks reject before mutation',t=>{const f=fixture(t);rmSync(join(f.payload,'app.js'));writeFileSync(join(f.root,'outside.js'),bytes(release,'app.js'));symlinkSync(join(f.root,'outside.js'),join(f.payload,'app.js'));assert.notEqual(run(f).status,0);untouched(f);assert.equal(existsSync(f.backup),false);});
test('temporary file preparation failure leaves every live byte unchanged',t=>{const f=fixture(t);const bin=join(f.root,'bin');mkdirSync(bin);writeFileSync(join(bin,'mktemp'),`#!/bin/bash\nif [[ -e '${f.root}/called' ]]; then exit 1; fi\ntouch '${f.root}/called'\nexec /usr/bin/mktemp "$@"\n`,{mode:0o755});assert.notEqual(run(f,{...process.env,PATH:bin+':'+process.env.PATH}).status,0);untouched(f);for(const file of changed)assert.deepEqual(readFileSync(join(f.backup,'files',file)),bytes(baseline,file));});
