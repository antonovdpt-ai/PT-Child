import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const [file,head,base]=process.argv.slice(2);
assert.ok(file&&head&&base,'Evidence path and reviewed head/base required');
const evidence=JSON.parse(await readFile(file,'utf8'));
for(const [field,value]of Object.entries({head,base,target:'production',sourceAudit:'preactivation',migrations:'008-012',backup:true,sqlVerification:true,edgeRuntime:true,syntheticIsolatedTarget:true,manualDesktopMobile:true,ancestryReconciled:true}))assert.equal(evidence[field],value,`Missing release gate: ${field}`);
console.log(`RELEASE_EVIDENCE_OK base=${base} head=${head}`);
