import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeParentEmail, uuid, sha256Hex, parentCors, parentJson, parentHandler } from './parent-portal.ts';
const id = '10000000-0000-4000-8000-000000000001';
const expires = '2026-10-10T00:00:00Z';
function fixture(options = {}) {
  const calls = [];
  const row = { id, patient_id: id, contact_id: id, therapist_id: id, email: ' Parent@Example.com ', email_normalized: 'parent@example.com', expires_at: expires, accepted_at: null, revoked_at: null };
  function client(scope) {
    return {
      auth: { getUser: async () => { calls.push('user'); return { data: { user: options.noUser ? null : { id } } }; },
        admin: { listUsers: async ({page}) => { calls.push('list:'+page); return { data: { users: options.paginated && page === 1 ? Array.from({length:1000},()=>({email:'other@example.com'})) : options.existing ? [{ email: 'parent@example.com' }] : [] }, error: options.listError }; },
          inviteUserByEmail: async (...args) => { calls.push(['invite', ...args]); return { error: options.deliveryError }; } },
        signInWithOtp: async (args) => { calls.push(['otp', args]); return { error: options.deliveryError }; } },
      rpc: async (name, args) => { calls.push([scope, name, args]); return name === 'account_is_active' ? { data: !options.inactive } : name === 'revoke_parent_access_record' ? { data: 1, error: options.rpcError } : name === 'current_app_roles' ? { data: options.parent ? [{role:'parent'}] : [{role:'specialist'}] } : { data: options.issueData === undefined ? [{ invitation_id: id, expires_at: expires }] : options.issueData, error: options.rpcError }; },
      from(table) { const filters = []; const query = { select() { return query; }, eq(k,v) { filters.push([k,v]); return query; }, async single() { calls.push([scope, table, filters]); return { data: options.denied && scope === 'user' ? null : { ...row, ...(options.accepted ? {accepted_at:expires} : {}), ...(options.nullContact ? {contact_id:null} : {}), ...(scope === 'admin' && options.emailRace ? {email_normalized:'changed@example.com'} : {}) } }; } }; return query; },
    };
  }
  const deps = { env: (name) => ({ SUPABASE_URL:'https://test.invalid', SUPABASE_ANON_KEY:'anon', SUPABASE_SERVICE_ROLE_KEY:'service' })[name],
    createClient: (_url,key,config) => { calls.push(['client',key,config]); return client(key === 'service' ? 'admin' : 'user'); } };
  return { calls, deps };
}
function request(body, extra = {}) { return new Request('https://edge.invalid', { method:'POST', headers:{ origin:'https://app.fizira.com', authorization:'Bearer valid', 'content-type':'application/json', ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body) }); }
const payload = { patient_id:id, contact_id:id };
test('helpers normalize, validate and hash without exposing values', async () => {
  assert.equal(normalizeParentEmail(' Parent@Example.COM '),'parent@example.com');
  for (const value of ['', null, 'bad', 'a@b', 'a b@c.com']) assert.throws(() => normalizeParentEmail(value));
  assert.equal(uuid(id), id); assert.throws(() => uuid('bad'));
  assert.equal(await sha256Hex('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(parentCors('https://evil.invalid'),null);
  assert.equal(parentJson('https://app.fizira.com',200,{ok:true}).headers.get('cache-control'),'no-store');
});
test('all wrappers use explicit payload allowlists and the shared handler', () => {
  for (const [name,keys] of [['create-parent-invitation',['patient_id','contact_id']],['resend-parent-invitation',['invitation_id']],['revoke-parent-access',['access_id']]]) {
    const source = readFileSync(new URL(`../${name}/index.ts`,import.meta.url),'utf8');
    assert.match(source,/parentHandler/); for (const key of keys) assert.ok(source.includes(`"${key}"`));
    assert.doesNotMatch(source,/console\.|storage_path|generateLink/);
  }
  const shared = readFileSync(new URL('./parent-portal.ts',import.meta.url),'utf8');
  assert.match(shared,/shouldCreateUser: false/);
  assert.ok(shared.indexOf('await authorizeOwnership') < shared.indexOf('const admin ='));
  assert.doesNotMatch(shared,/console\.|generateLink|updateUserById/);
});
test('malformed bodies, unknown fields and identifiers never create service clients', async () => {
  for (const body of ['{', null, [], { ...payload,email:'attacker@example.com' }, { patient_id:'bad',contact_id:id }, { ...payload,storage_path:'secret' }, ' '.repeat(1025)]) {
    const f = fixture(); const result = await parentHandler('create', ['patient_id','contact_id'], f.deps)(request(body));
    assert.equal(result.status,400); assert.deepEqual(await result.json(),{error:'Request could not be completed'});
    assert.ok(!f.calls.some(c=>c[0]==='client' && c[1]==='service'));
  }
});
test('authorization rejects missing bearer, invalid identity, parent role and nonowned rows before admin', async () => {
  for (const option of [{noUser:true},{parent:true},{denied:true},{inactive:true}]) {
    const f = fixture(option); const response = await parentHandler('create',['patient_id','contact_id'],f.deps)(request(payload));
    assert.ok([401,403].includes(response.status)); assert.ok(!f.calls.some(c=>c[0]==='client' && c[1]==='service'));
  }
  const f = fixture(); assert.equal((await parentHandler('create',['patient_id','contact_id'],f.deps)(request(payload,{authorization:''}))).status,401);
  assert.equal(f.calls.length,0);
});
test('new and existing deliveries have identical public success and digest-only RPC', async () => {
  for (const existing of [false,true]) {
    const f = fixture({existing}); const response = await parentHandler('create',['patient_id','contact_id'],f.deps)(request(payload));
    assert.equal(response.status,200); assert.deepEqual(await response.json(),{ok:true,expires_at:expires});
    const issued = f.calls.find(c=>c[1]==='issue_parent_invitation_record');
    assert.match(issued[2].p_token_digest,/^[a-f0-9]{64}$/); assert.equal(issued[2].p_auth_flow,existing?'existing':'new');
    const delivery = f.calls.find(c=>c[0]===(existing?'otp':'invite'));
    const redirect = existing ? delivery[1].options.emailRedirectTo : delivery[2].redirectTo;
    assert.match(redirect,/^https:\/\/app\.fizira\.com\/parent\.html\?invite=[A-Za-z0-9_-]{43}$/);
    assert.equal(await sha256Hex(new URL(redirect).searchParams.get('invite')),issued[2].p_token_digest);
    if (existing) assert.equal(delivery[1].options.shouldCreateUser,false);
    assert.ok(f.calls.findIndex(c=>c[1]==='patient_contacts') < f.calls.findIndex(c=>c==='list:1'));
  }
});
test('Auth errors, RPC failures and email races are generic and do not leak internals', async () => {
  for (const option of [{deliveryError:{message:'secret token link email exists'}},{existing:true,deliveryError:{message:'account exists'}},{rpcError:{message:'database secret'}},{listError:{message:'auth secret'}},{emailRace:true}]) {
    const f = fixture(option); const response = await parentHandler('create',['patient_id','contact_id'],f.deps)(request(payload));
    assert.equal(response.status,503); assert.deepEqual(await response.json(),{error:'Request could not be completed'});
    if (option.emailRace || option.rpcError || option.listError) assert.ok(!f.calls.some(c=>['invite','otp'].includes(c[0])));
  }
});
test('resend verifies invitation, patient, contact then uses the atomic issue RPC; revoke verifies access/patient first', async () => {
  for (const [operation,keys,body] of [['resend',['invitation_id'],{invitation_id:id}],['revoke',['access_id'],{access_id:id}]]) {
    const f = fixture(); const result = await parentHandler(operation,keys,f.deps)(request(body)); assert.equal(result.status,200);
    const serviceIndex = f.calls.findIndex(c=>c[0]==='client' && c[1]==='service');
    assert.ok(f.calls.findIndex(c=>c[1]===(operation==='resend'?'parent_invitations':'parent_child_access'))<serviceIndex);
    assert.ok(f.calls.findIndex(c=>c[1]==='patients')<serviceIndex);
    assert.deepEqual(await result.json(),operation==='revoke'?{ok:true}:{ok:true,expires_at:expires});
    assert.ok(f.calls.some(c=>c[1]===(operation==='revoke'?'revoke_parent_access_record':'issue_parent_invitation_record')));
  }
});
test('untrusted CORS and methods stop before any clients; all responses no-store', async () => {
  for (const [method,origin,status] of [['POST','https://evil.invalid',403],['GET','https://app.fizira.com',405],['OPTIONS','https://app.fizira.com',204]]) {
    const f=fixture(); const result=await parentHandler('create',['patient_id','contact_id'],f.deps)(new Request('https://edge.invalid',{method,headers:{origin}}));
    assert.equal(result.status,status); assert.equal(result.headers.get('cache-control'),'no-store'); assert.equal(f.calls.length,0);
    if(status===403) assert.equal(result.headers.get('access-control-allow-origin'),null);
  }
});

test('paginated Auth lookup does not mistake later existing users for new', async () => {
  const f=fixture({existing:true,paginated:true});
  const response=await parentHandler('create',['patient_id','contact_id'],f.deps)(request(payload));
  assert.equal(response.status,200); assert.ok(f.calls.includes('list:2')); assert.ok(f.calls.some(c=>c[0]==='otp'));
});
test('invalid service responses fail closed before delivery', async () => {
  for (const issueData of [null, [], [{invitation_id:'bad',expires_at:expires}], [{invitation_id:id,expires_at:'bad'}], [{invitation_id:id,expires_at:expires},{invitation_id:id,expires_at:expires}]]) {
    const f=fixture({issueData}); const result=await parentHandler('create',['patient_id','contact_id'],f.deps)(request(payload));
    assert.ok(result.status >= 400); assert.deepEqual(await result.json(),{error:'Request could not be completed'});
    assert.ok(!f.calls.some(c=>['invite','otp'].includes(c[0])));
  }
});
test('accepted resend stops before service, null-contact access remains revocable, revoke RPC errors are generic', async () => {
  let f=fixture({accepted:true});
  assert.equal((await parentHandler('resend',['invitation_id'],f.deps)(request({invitation_id:id}))).status,403);
  assert.ok(!f.calls.some(c=>c[0]==='client' && c[1]==='service'));
  f=fixture({nullContact:true});
  assert.equal((await parentHandler('revoke',['access_id'],f.deps)(request({access_id:id}))).status,200);
  f=fixture({rpcError:{message:'secret'}});
  const response=await parentHandler('revoke',['access_id'],f.deps)(request({access_id:id}));
  assert.equal(response.status,503); assert.deepEqual(await response.json(),{error:'Request could not be completed'});
});
