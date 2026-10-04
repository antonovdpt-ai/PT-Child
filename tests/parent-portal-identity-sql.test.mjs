import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const specialist = '11111111-1111-4111-8111-111111111111';
const otherSpecialist = '22222222-2222-4222-8222-222222222222';
const parentA = '33333333-3333-4333-8333-333333333333';
const wrongParent = '44444444-4444-4444-8444-444444444444';
const childA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const childB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const contactA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const contactB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const documents = ['terms', 'privacy', 'personal_data_consent'].map(document_type => ({document_type, accepted:true}));
const token = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
const sourceTables = ['patients', 'assessments', 'sessions', 'goals', 'patient_media', 'parent_reports', 'standardized_assessments'];

// These tests catch actual authorization, state-transition and authoritative-consent
// failures by executing the migration and RPCs as real PostgreSQL roles.
test('parent identity SQL enforces invitation, role, consent and clinical boundaries', async t => {
  const migration = await readFile(new URL('../supabase/migrations/20261003_008_parent_portal_identity.sql', import.meta.url), 'utf8');
  const db = new PGlite();
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const scalar = async (sql, args = []) => Object.values((await query(sql, args))[0])[0];
  const as = async (role, user, fn) => {
    await db.exec(`reset role; set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user || '']);
    try { return await fn(); } finally { await db.exec('reset role'); }
  };
  const rpc = (user, name, args = []) => as('authenticated', user, () => scalar(`select public.${name}(${args.map((_, i) => '$'+(i+1)).join(',')})`, args));
  const accept = (user, value, docs = documents) => rpc(user, 'accept_parent_invitation', [value, JSON.stringify(docs)]);
  const issue = (value, therapist = specialist, child = childA, contact = contactA, flow = 'new') => as('service_role', null, () => query('select * from public.issue_parent_invitation_record($1,$2,$3,$4,$5)', [therapist, child, contact, digest(value), flow]));
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to authenticated, anon, service_role;
      create table public.patients(id uuid primary key, therapist_id uuid not null references auth.users);
      create table public.patient_contacts(id uuid primary key, patient_id uuid not null references public.patients, therapist_id uuid not null references auth.users, full_name text not null);
      create table public.user_consents(id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users, terms_version text not null, privacy_version text not null, accepted_at timestamptz not null default now(), unique(user_id,terms_version,privacy_version));
      alter table public.user_consents enable row level security;
      create policy user_consents_select_own on public.user_consents for select to authenticated using(user_id=auth.uid());
      insert into auth.users(id,email) values ('${specialist}','specialist@example.test'),('${otherSpecialist}','other@example.test');
      insert into public.patients values ('${childA}','${specialist}'),('${childB}','${otherSpecialist}');
      insert into public.patient_contacts values ('${contactA}','${childA}','${specialist}','Family'),('${contactB}','${childB}','${otherSpecialist}','Other family');
      insert into public.user_consents(user_id,terms_version,privacy_version,accepted_at) values ('${specialist}','legacy','legacy','2020-01-01');
    `);
    for (const table of sourceTables) {
      if (table !== 'patients') await db.exec(`create table public.${table}(id uuid primary key default gen_random_uuid(), therapist_id uuid not null references auth.users)`);
      await db.exec(`alter table public.${table} enable row level security; create policy ${table}_select_own on public.${table} for select to authenticated using(therapist_id=auth.uid()); grant select on public.${table} to authenticated`);
    }
    await db.exec(await readFile(new URL('../supabase/migrations/20260930_007_legal_acceptances.sql', import.meta.url), 'utf8'));
    const policiesBefore = await query("select tablename,policyname,cmd,qual,with_check from pg_policies where tablename=any($1) order by tablename,policyname", [sourceTables]);
    await db.exec(migration);

    await t.test('only initial users become specialists; retry cannot promote later parents', async () => {
      assert.deepEqual(await query('select user_id,role from public.app_user_roles order by user_id'), [{user_id:specialist,role:'specialist'},{user_id:otherSpecialist,role:'specialist'}]);
      await db.query('insert into auth.users(id,email) values ($1,$2),($3,$4)', [parentA,'Parent@Example.test',wrongParent,'wrong@example.test']);
      await db.exec(migration);
      assert.equal(await scalar('select count(*)::int from public.app_user_roles'), 2);
      assert.deepEqual(await as('authenticated', parentA, () => query('select * from current_app_roles()')), []);
      for(const [type,path] of [['terms','terms'],['privacy','privacy'],['personal_data_consent','consent']]) {
        const [document] = await query('select * from legal_document_versions where document_type=$1',[type]);
        assert.equal(document.document_version,'1.0');
        assert.equal(document.document_hash,createHash('sha256').update(await readFile(new URL(`../landing/${path}/index.html`,import.meta.url))).digest('hex'));
        assert.equal(document.public_url,`https://fizira.com/${path}`);
      }
    });

    await t.test('legacy contacts/consents survive and contact email is normalized/validated', async () => {
      assert.equal(await scalar('select email from patient_contacts where id=$1', [contactA]), null);
      await db.query('update patient_contacts set email=$1 where id=$2', ['  Parent@Example.test  ',contactA]);
      assert.equal(await scalar('select email from patient_contacts where id=$1', [contactA]), 'parent@example.test');
      await assert.rejects(db.query('update patient_contacts set email=$1 where id=$2', ['not an email',contactA]), /email|check/i);
      assert.equal(await scalar("select count(*)::int from user_consents where terms_version='legacy' and accepted_at='2020-01-01'"), 1);
      assert.equal(await rpc(specialist, 'record_legal_acceptances', [JSON.stringify([{document_type:'terms',document_version:'legacy-other'}]),'legacy-regression']), 1);
    });

    const firstToken = token();
    let firstInvitation;
    await t.test('service issue validates ownership/digest/flow and stores no raw token with exactly seven days expiry', async () => {
      await assert.rejects(issue(token(),otherSpecialist), /ownership|specialist|contact/i);
      await assert.rejects(issue(token(),specialist,childB), /ownership|specialist|contact/i);
      await assert.rejects(issue(token(),specialist,childA,contactA,'bad'), /flow/i);
      await assert.rejects(as('service_role',null,()=>query('select * from issue_parent_invitation_record($1,$2,$3,$4,$5)',[specialist,childA,contactA,'A'.repeat(64),'new'])), /digest/i);
      [firstInvitation] = await issue(firstToken);
      const row = (await query('select *, extract(epoch from expires_at-created_at)::int as seconds from parent_invitations where id=$1',[firstInvitation.invitation_id]))[0];
      assert.equal(row.seconds,604800);
      assert.equal(row.token_digest,digest(firstToken));
      assert.match(row.token_digest,/^[0-9a-f]{64}$/);
      assert.equal(row.email_normalized,'parent@example.test');
      assert.equal(Object.keys(row).some(key=>key==='token'||key==='raw_token'),false);
      assert.deepEqual(await rpc(parentA,'parent_invitation_state',[firstToken]),{state:'valid',auth_flow:'new'});
      assert.deepEqual(await rpc(wrongParent,'parent_invitation_state',[firstToken]),{state:'email_mismatch'});
      await assert.rejects(accept(wrongParent,firstToken),/email/i);
    });

    const liveToken = token();
    await t.test('resend retains but revokes prior invitation, with no identity in state', async () => {
      await issue(liveToken,specialist,childA,contactA,'existing');
      assert.deepEqual(await rpc(parentA,'parent_invitation_state',[firstToken]),{state:'revoked'});
      await assert.rejects(accept(parentA,firstToken),/invitation/i);
      assert.equal(await scalar('select revoked_by from parent_invitations where id=$1',[firstInvitation.invitation_id]),specialist);
      assert.equal(await scalar('select count(*)::int from parent_invitations'),2);
      assert.deepEqual(await rpc(parentA,'parent_invitation_state',[token()]),{state:'invalid'});
      await assert.rejects(rpc(null,'parent_invitation_state',[liveToken]), /authentication/i);
      await assert.rejects(rpc(parentA,'parent_invitation_state',['x'.repeat(257)]), /token/i);
    });

    await t.test('legal choices are exact and rejection leaves invitation/roles/links/consents unchanged', async () => {
      for (const malformed of [null,{},[],documents.slice(1),[null,...documents.slice(1)],['terms',...documents.slice(1)],[...documents,documents[0]],documents.map(d=>({...d,accepted:false})),documents.map(d=>({...d,accepted:'true'})),documents.map(d=>({...d,document_version:'spoofed',document_hash:'0'.repeat(64),accepted_at:'2000-01-01'}))]) {
        await assert.rejects(accept(parentA,liveToken,malformed), /document|acceptance/i);
      }
      assert.equal(await scalar('select count(*)::int from parent_child_access'),0);
      assert.equal(await scalar('select count(*)::int from app_user_roles where user_id=$1',[parentA]),0);
      assert.equal(await scalar('select count(*)::int from user_consents where user_id=$1',[parentA]),0);
      assert.deepEqual(await rpc(parentA,'parent_invitation_state',[liveToken]),{state:'valid',auth_flow:'existing'});
      await db.exec("update legal_document_versions set is_required=false where document_type='terms'");
      await assert.rejects(accept(parentA,liveToken),/documents/i);
      assert.equal(await scalar('select count(*)::int from user_consents where user_id=$1',[parentA]),0,'even consent inserts preceding a later exception roll back');
      assert.equal(await scalar('select count(*)::int from parent_consent_audit where user_id=$1',[parentA]),0,'audit writes preceding a later exception roll back too');
      await db.exec("update legal_document_versions set is_required=true where document_type='terms'");
    });

    let accessId;
    let priorConsent;
    await t.test('acceptance atomically grants parent/access and authoritative current legal metadata/time', async () => {
      // A legacy RPC can preseed arbitrary metadata: it must not defeat authoritative parent consent.
      await rpc(parentA,'record_legal_acceptances',[JSON.stringify([{document_type:'terms',document_version:'1.0',document_hash:'0'.repeat(64)}]),'spoof']);
      priorConsent = await scalar("select to_jsonb(c) from user_consents c where user_id=$1 and document_type='terms'",[parentA]);
      const before = Date.now();
      accessId = await accept(parentA,liveToken,[...documents].reverse());
      assert.equal(await scalar('select id from parent_child_access where parent_user_id=$1',[parentA]), accessId);
      assert.deepEqual(await as('authenticated',parentA,()=>query('select * from current_app_roles()')),[{role:'parent'}]);
      assert.equal(await rpc(parentA,'parent_has_active_access',[parentA,childA]),true);
      assert.equal(await rpc(parentA,'parent_has_active_access',[parentA,childB]),false);
      assert.equal(await rpc(wrongParent,'parent_has_active_access',[parentA,childA]),false);
      const consents = await query('select c.* from user_consents c where user_id=$1 order by document_type',[parentA]);
      assert.equal(consents.length,3);
      for(const consent of consents) {
        const current = (await query('select * from legal_document_versions where document_type=$1 and is_active',[consent.document_type]))[0];
        assert.equal(consent.document_version,current.document_version);
        assert.equal(consent.document_hash,current.document_hash);
        assert.ok(new Date(consent.accepted_at).getTime()>=before);
        assert.equal(consent.source,'parent-invitation');
      }
      assert.deepEqual(await rpc(parentA,'parent_invitation_state',[liveToken]),{state:'accepted'});
      await assert.rejects(accept(parentA,liveToken),/invitation/i);
    });

    await t.test('owner mismatch and duplicate active relations are rejected at the table boundary', async () => {
      await assert.rejects(db.query('insert into parent_child_access(parent_user_id,patient_id,therapist_id,contact_id) values ($1,$2,$3,$4)',[wrongParent,childA,otherSpecialist,contactA]),/owner|therapist/i);
      await assert.rejects(db.query('insert into parent_child_access(parent_user_id,patient_id,therapist_id,contact_id) values ($1,$2,$3,$4)',[parentA,childA,specialist,contactA]),/unique|duplicate/i);
      await assert.rejects(db.query('update parent_child_access set therapist_id=$1 where id=$2',[otherSpecialist,accessId]),/owner|therapist/i);
      await assert.rejects(db.query('update parent_child_access set contact_id=$1 where id=$2',[contactB,accessId]),/contact/i);
    });

    await t.test('RLS and grants deny browser mutations/anon RPCs without touching clinical policies', async () => {
      assert.deepEqual(await query("select tablename,policyname,cmd,qual,with_check from pg_policies where tablename=any($1) order by tablename,policyname",[sourceTables]),policiesBefore);
      for(const table of sourceTables) assert.equal(await as('authenticated',parentA,()=>scalar(`select count(*)::int from public.${table}`)),0);
      assert.equal(await as('authenticated',specialist,()=>scalar('select count(*)::int from patients')),1);
      for(const table of ['app_user_roles','parent_child_access','parent_invitations','legal_document_versions','parent_consent_audit']) {
        for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE']) assert.equal(await scalar('select has_table_privilege($1,$2,$3)',['authenticated',`public.${table}`,privilege]),false);
        assert.equal(await scalar('select relrowsecurity from pg_class where oid=$1::regclass',[`public.${table}`]),true);
      }
      await assert.rejects(as('authenticated',parentA,()=>query("insert into app_user_roles(user_id,role) values ($1,'specialist')",[parentA])),/permission denied/i);
      for(const name of ['current_app_roles','parent_has_active_access','parent_invitation_state','accept_parent_invitation','issue_parent_invitation_record','revoke_parent_access_record']) {
        const [f] = await query("select oid,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname=$1",[name]);
        assert.equal(f.prosecdef,true);
        assert.deepEqual(f.proconfig,['search_path=pg_catalog, public']);
        assert.equal(await scalar("select has_function_privilege('anon',$1::oid,'EXECUTE')",[f.oid]),false);
        if(name.endsWith('_record')) assert.equal(await scalar("select has_function_privilege('authenticated',$1::oid,'EXECUTE')",[f.oid]),false);
      }
      await assert.rejects(as('anon',null,()=>query('select current_app_roles()')),/permission denied/i);
      await assert.rejects(rpc(null,'current_app_roles'),/authentication/i);
      await assert.rejects(rpc(null,'parent_has_active_access',[parentA,childA]),/authentication/i);
      await assert.rejects(accept(null,token()),/authentication/i);
      await assert.rejects(as('authenticated',specialist,()=>query('select * from issue_parent_invitation_record($1,$2,$3,$4,$5)',[specialist,childA,contactA,digest(token()),'new'])),/permission denied/i);
      await assert.rejects(as('authenticated',specialist,()=>query('select revoke_parent_access_record($1,$2)',[specialist,accessId])),/permission denied/i);
      assert.equal(await as('authenticated',parentA,()=>scalar('select count(*)::int from parent_invitations')),0);
      assert.equal(await as('authenticated',otherSpecialist,()=>scalar('select count(*)::int from parent_invitations')),0);
      assert.equal(await as('authenticated',specialist,()=>scalar('select count(*)::int from parent_invitations')),2);
    });

    await t.test('revocation is owner-only, retains history, invalidates pending invites and prevents access', async () => {
      const pending = token(); await issue(pending);
      await assert.rejects(as('service_role',null,()=>scalar('select revoke_parent_access_record($1,$2)',[otherSpecialist,accessId])),/ownership|specialist/i);
      assert.equal(await as('service_role',null,()=>scalar('select revoke_parent_access_record($1,$2)',[specialist,accessId])),1);
      assert.equal(await rpc(parentA,'parent_has_active_access',[parentA,childA]),false);
      assert.deepEqual(await rpc(parentA,'parent_invitation_state',[pending]),{state:'revoked'});
      await assert.rejects(accept(parentA,pending),/invitation/i);
      const [access] = await query('select status,revoked_by,revoked_at from parent_child_access where id=$1',[accessId]);
      assert.equal(access.status,'revoked'); assert.equal(access.revoked_by,specialist); assert.ok(access.revoked_at);
      assert.equal(await as('service_role',null,()=>scalar('select revoke_parent_access_record($1,$2)',[specialist,accessId])),0);
      assert.equal(await scalar('select count(*)::int from parent_child_access'),1);
    });

    await t.test('second same-version acceptance preserves all original consent evidence in an immutable audit', async () => {
      const originals = (await query('select to_jsonb(c) as snapshot from user_consents c where user_id=$1 order by document_type',[parentA])).map(row=>row.snapshot);
      const second = token(); const [secondInvitation] = await issue(second);
      const originalAudit = await query('select * from parent_consent_audit where user_id=$1 order by recorded_at,id',[parentA]);
      await db.exec("update legal_document_versions set is_required=false where document_type='terms'");
      try {
        await assert.rejects(accept(parentA,second),/documents/i);
        assert.deepEqual((await query('select to_jsonb(c) as snapshot from user_consents c where user_id=$1 order by document_type',[parentA])).map(row=>row.snapshot),originals,'failed second acceptance rolls back canonical updates');
        assert.deepEqual(await query('select * from parent_consent_audit where user_id=$1 order by recorded_at,id',[parentA]),originalAudit,'failed second acceptance rolls back archived and authoritative evidence');
      } finally {
        await db.exec("update legal_document_versions set is_required=true where document_type='terms'");
      }
      const before = Date.now();
      const secondAccess = await accept(parentA,second);
      try {
        assert.notEqual(secondAccess,accessId);
        const current = await query('select * from user_consents where user_id=$1 order by document_type',[parentA]);
        for(const consent of current) {
          assert.ok(new Date(consent.accepted_at).getTime()>=before);
          assert.equal(consent.source,'parent-invitation');
          assert.equal(consent.document_hash,await scalar('select document_hash from legal_document_versions where document_type=$1 and is_active',[consent.document_type]));
        }
        assert.ok(await scalar("select to_regclass('public.parent_consent_audit')"),
          'second acceptance overwrites canonical metadata; original evidence must survive separately');
        const evidence = await query('select * from parent_consent_audit where user_id=$1 order by recorded_at,id',[parentA]);
        for(const original of [priorConsent,...originals]) {
          assert.ok(evidence.some(record=>record.evidence_kind==='prior-consent'
            && record.consent_snapshot.id===original.id
            && record.document_hash===original.document_hash
            && new Date(record.accepted_at).getTime()===new Date(original.accepted_at).getTime()
            && record.source===original.source),`prior ${original.document_type} evidence retained exactly`);
          const snapshot = evidence.find(record=>record.evidence_kind==='prior-consent'
            && record.consent_snapshot.id===original.id && record.source===original.source);
          assert.deepEqual(snapshot.consent_snapshot,original,'complete prior row retained');
        }
        assert.equal(evidence.filter(record=>record.evidence_kind==='parent-acceptance').length,6);
        const secondEvidence = evidence.filter(record=>record.invitation_id===secondInvitation.invitation_id);
        assert.equal(secondEvidence.length,3);
        for(const record of secondEvidence) {
          const consent = current.find(consent=>consent.document_type===record.document_type);
          assert.equal(record.document_hash,consent.document_hash);
          assert.equal(new Date(record.accepted_at).getTime(),new Date(consent.accepted_at).getTime());
          assert.equal(record.source,'parent-invitation');
        }
        // Also deny destructive writes to the table owner, not just browser roles.
        await assert.rejects(db.exec("update parent_consent_audit set source='changed'"),/append.only/i);
        await assert.rejects(db.exec('delete from parent_consent_audit'),/append.only/i);
        await assert.rejects(db.exec('truncate parent_consent_audit'),/append.only/i);
        for(const role of ['authenticated','anon','service_role']) {
          for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE']) {
            assert.equal(await scalar('select has_table_privilege($1,$2,$3)',[role,'public.parent_consent_audit',privilege]),false);
          }
        }
        await assert.rejects(as('authenticated',parentA,()=>query('select * from parent_consent_audit')),/permission denied/i);
        assert.equal(await scalar("select count(*)::int from pg_constraint where conrelid='parent_consent_audit'::regclass and contype='f'"),0,'evidence cannot disappear through lifecycle FK cascades');
        for(const name of ['preserve_prior_parent_consent','reject_parent_consent_audit_mutation']) {
          const [f] = await query("select oid,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname=$1",[name]);
          assert.equal(f.prosecdef,true);
          assert.deepEqual(f.proconfig,['search_path=pg_catalog, public']);
          for(const role of ['authenticated','anon','service_role']) assert.equal(await scalar("select has_function_privilege($1,$2::oid,'EXECUTE')",[role,f.oid]),false);
        }
        assert.deepEqual(await query('select * from parent_consent_audit where user_id=$1 order by recorded_at,id',[parentA]),evidence);
        await db.exec(migration);
        assert.deepEqual(await query('select * from parent_consent_audit where user_id=$1 order by recorded_at,id',[parentA]),evidence,'migration replay leaves audit immutable');
      } finally {
        await as('service_role',null,()=>scalar('select revoke_parent_access_record($1,$2)',[specialist,secondAccess]));
      }
    });

    await t.test('regrant retains revoked link history and uses newly active legal records across retries', async () => {
      await db.exec("update legal_document_versions set is_active=false where document_type='terms'; insert into legal_document_versions(document_type,document_version,document_hash,public_url) values('terms','2.0',repeat('a',64),'https://fizira.com/terms')");
      const next = token(); await issue(next);
      const newAccess = await accept(parentA,next);
      assert.notEqual(newAccess,accessId);
      assert.equal(await scalar("select count(*)::int from parent_child_access where status='revoked'"),2);
      assert.equal(await scalar("select document_hash from user_consents where user_id=$1 and document_type='terms' and document_version='2.0'",[parentA]),'a'.repeat(64));
      const redundant = token(); await issue(redundant);
      assert.equal(await accept(parentA,redundant),newAccess,'another accepted invitation must not create a duplicate active relation');
      await db.exec(migration);
      assert.equal(await scalar("select count(*)::int from app_user_roles where user_id=$1 and role='specialist'",[parentA]),0);
      assert.equal(await scalar("select count(*)::int from parent_child_access where status='active'"),1);
      assert.equal(await scalar("select document_version from legal_document_versions where document_type='terms' and is_active"),'2.0');
      await as('service_role',null,()=>scalar('select revoke_parent_access_record($1,$2)',[specialist,newAccess]));
    });

    await t.test('expired, changed-email and transferred-child invitations cannot grant access', async () => {
      const expired = token(); const [i] = await issue(expired);
      await db.query("update parent_invitations set created_at=now()-interval '8 days',expires_at=now()-interval '1 day' where id=$1",[i.invitation_id]);
      assert.deepEqual(await rpc(parentA,'parent_invitation_state',[expired]),{state:'expired'});
      await assert.rejects(accept(parentA,expired),/invitation/i);
      const changed = token(); await issue(changed);
      await db.query("update patient_contacts set email='changed@example.test' where id=$1",[contactA]);
      await assert.rejects(accept(parentA,changed),/contact|invitation|email/i);
      await db.query("update patient_contacts set email='parent@example.test' where id=$1",[contactA]);
      const transferred = token(); await issue(transferred);
      await db.query('update patients set therapist_id=$1 where id=$2',[otherSpecialist,childA]);
      await assert.rejects(accept(parentA,transferred),/owner|invitation|therapist/i);
      assert.equal(await scalar("select count(*)::int from parent_child_access where status='active'"),0);
    });

    await t.test('deployment verification executes and rejects accidental direct role grants', async () => {
      await db.exec('create schema storage; create table storage.buckets(id text,name text,public boolean)');
      // This fixture installs identity (008) only; publications (009) have their
      // own executable verification and failure-injection fixture.
      const verification = (await readFile(new URL('../supabase/verification/verify_migration.sql',import.meta.url),'utf8'))
        .split('-- Parent publication boundary (009).')[0].replace('\\set on_error_stop on','');
      await db.exec(verification);
      await db.exec('grant insert on app_user_roles to authenticated');
      await assert.rejects(db.exec(verification),/Unexpected direct parent identity grants/i);
      await db.exec('revoke insert on app_user_roles from authenticated');
      await db.exec(verification);
      await db.exec('grant insert on parent_consent_audit to authenticated');
      await assert.rejects(db.exec(verification),/Unexpected direct parent identity grants/i);
      await db.exec('revoke insert on parent_consent_audit from authenticated');
      for(const [table,trigger] of [['parent_consent_audit','parent_consent_audit_append_only'],['user_consents','preserve_prior_parent_consent']]) {
        await db.exec(`alter table ${table} disable trigger ${trigger}`);
        await assert.rejects(db.exec(verification),/Unsafe parent consent audit trigger/i);
        await db.exec(`alter table ${table} enable trigger ${trigger}`);
      }
      await db.exec(verification);
    });
  } finally { await db.close(); }
});
