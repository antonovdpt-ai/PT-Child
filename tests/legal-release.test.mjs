import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const app = await readFile(new URL('app.js', root), 'utf8');
const migration = await readFile(
  new URL('supabase/migrations/20260930_007_legal_acceptances.sql', root),
  'utf8',
);
const baseSchema = await readFile(
  new URL('supabase/migrations/20260920_001_app_schema.sql', root),
  'utf8',
);
const legalCss = await readFile(new URL('landing/legal.css', root), 'utf8');
const landingHtml = await readFile(new URL('landing/index.html', root), 'utf8');
const landingCss = await readFile(new URL('landing/styles.css', root), 'utf8');

const legalFiles = {
  privacy: 'landing/privacy/index.html',
  terms: 'landing/terms/index.html',
  consent: 'landing/consent/index.html',
  'data-processing': 'landing/data-processing/index.html',
  'delete-account': 'landing/delete-account/index.html',
};

const legalHtml = Object.fromEntries(
  await Promise.all(
    Object.entries(legalFiles).map(async ([name, path]) => [
      name,
      await readFile(new URL(path, root), 'utf8'),
    ]),
  ),
);

test('registration requires two separate unchecked legal confirmations', () => {
  const termsInput = app.match(/<input type="checkbox" name="terms_accepted"[^>]*>/)?.[0];
  const consentInput = app.match(/<input type="checkbox" name="personal_data_consent"[^>]*>/)?.[0];

  assert.ok(termsInput);
  assert.ok(consentInput);
  assert.match(termsInput, /\brequired\b/);
  assert.match(consentInput, /\brequired\b/);
  assert.doesNotMatch(termsInput, /\bchecked\b/);
  assert.doesNotMatch(consentInput, /\bchecked\b/);
  assert.match(app, /https:\/\/fizira\.com\/terms/);
  assert.match(app, /https:\/\/fizira\.com\/privacy/);
  assert.match(app, /https:\/\/fizira\.com\/consent/);
  assert.match(app, /if \(!termsAccepted \|\| !personalDataConsent\)/);
});

test('release document hashes in the client match published files', async () => {
  for (const [type, path] of [
    ['terms', legalFiles.terms],
    ['privacy', legalFiles.privacy],
    ['personalDataConsent', legalFiles.consent],
  ]) {
    const html = await readFile(new URL(path, root));
    const hash = createHash('sha256').update(html).digest('hex');
    const pattern = new RegExp(`${type}:[\\s\\S]{0,180}hash: '${hash}'`);
    assert.match(app, pattern, `${type} hash is stale`);
  }
});

test('public legal pages contain final operator contacts and no placeholders', () => {
  for (const [name, html] of Object.entries(legalHtml)) {
    assert.match(html, /Fizira/, name);
    assert.match(html, /support@fizira\.com|privacy@fizira\.com/, name);
    assert.doesNotMatch(html, /будет создан позднее|\[УКАЗАТЬ|\[ОТЧЕСТВО|no-reply@fizira\.com/i, name);
    assert.doesNotMatch(html, /\+79081732888|79081732888/, name);
  }

  assert.match(legalHtml.privacy, /ИНН 612506111865/);
  assert.match(legalHtml.privacy, /ОГРНИП 326619600224256/);
  assert.match(legalHtml.privacy, /до 6 месяцев/);
  assert.match(legalHtml.privacy, /до 90 дней/);
  assert.match(legalHtml['delete-account'], /раздел «Профиль»/);
});

test('public routes, footer links and responsive legal layouts are committed', () => {
  for (const route of ['privacy', 'terms', 'delete-account']) {
    assert.ok(legalHtml[route], `${route} route is missing`);
    assert.match(landingHtml, new RegExp(`href="/${route}"`));
  }
  assert.match(landingHtml, /mailto:support@fizira\.com/);
  assert.match(legalCss, /@media \(max-width: 700px\)/);
  assert.match(legalCss, /@media \(max-width: 390px\)/);
  assert.match(legalCss, /width: min\(100% - 20px, 960px\)/);
  assert.match(landingCss, /@media \(max-width: 620px\)/);
});

test('acceptances are recorded per document by an authenticated server function', () => {
  assert.match(migration, /add column if not exists document_type text/);
  assert.match(migration, /add column if not exists document_version text/);
  assert.match(migration, /create or replace function public\.record_legal_acceptances/);
  assert.match(migration, /create or replace function public\.capture_signup_legal_acceptances/);
  assert.match(migration, /after insert on auth\.users/);
  assert.match(migration, /current_user_id uuid := auth\.uid\(\)/);
  assert.match(baseSchema, /accepted_at timestamp with time zone DEFAULT now\(\) NOT NULL/i);
  assert.match(migration, /grant execute on function public\.record_legal_acceptances\(jsonb, text\) to authenticated/);
  assert.match(migration, /revoke insert, update, delete on table public\.user_consents from authenticated/);
  assert.match(app, /sb\.rpc\('record_legal_acceptances'/);
});

test('legal acceptance migration preserves legacy history and records server-timed documents', async () => {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    create table auth.users (
      id uuid primary key,
      raw_user_meta_data jsonb default '{}'::jsonb not null
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.user_consents (
      id uuid default gen_random_uuid() primary key,
      user_id uuid not null references auth.users(id) on delete cascade,
      terms_version text not null,
      privacy_version text not null,
      accepted_at timestamptz default now() not null,
      unique (user_id, terms_version, privacy_version)
    );
    alter table public.user_consents enable row level security;
    create policy user_consents_insert_own on public.user_consents
      for insert to authenticated with check (user_id = auth.uid());
    create policy user_consents_select_own on public.user_consents
      for select to authenticated using (user_id = auth.uid());
    grant select, insert, update, delete on public.user_consents to authenticated;
  `);

  const userId = '11111111-1111-4111-8111-111111111111';
  await db.query('insert into auth.users (id) values ($1)', [userId]);
  await db.query(
    `insert into public.user_consents
      (user_id, terms_version, privacy_version, accepted_at)
     values ($1, 'pre-release-v1', 'pre-release-v1', '2026-09-20T10:00:00Z')`,
    [userId],
  );

  await db.exec(migration);
  const backfill = await db.query(`
    select document_type, document_version, accepted_at
    from public.user_consents
    where document_type is not null
    order by document_type
  `);
  assert.deepEqual(
    backfill.rows.map(row => [row.document_type, row.document_version]),
    [['privacy', 'pre-release-v1'], ['terms', 'pre-release-v1']],
  );

  const signupUserId = '22222222-2222-4222-8222-222222222222';
  const signupMetadata = {
    legal_acceptance_source: 'web-registration-v1',
    legal_documents: [
      {
        type: 'terms',
        version: '1.0',
        hash: 'fdbab5aa8ba0fe7a9d453659a7723231ab0193ce93cf43128c974f75e5bf9f26',
      },
      {
        type: 'privacy',
        version: '1.0',
        hash: '422ebcc1a8af520320cf5cd415dc3426ce471ba75d0a4bdb6395adb0d1ac86dd',
      },
    ],
  };
  await db.query(
    'insert into auth.users (id, raw_user_meta_data) values ($1, $2::jsonb)',
    [signupUserId, JSON.stringify(signupMetadata)],
  );
  const signupRecords = await db.query(`
    select document_type, document_version, source, accepted_at
    from public.user_consents
    where user_id = $1
    order by document_type
  `, [signupUserId]);
  assert.deepEqual(
    signupRecords.rows.map(row => [row.document_type, row.document_version, row.source]),
    [
      ['privacy', '1.0', 'web-registration-v1'],
      ['terms', '1.0', 'web-registration-v1'],
    ],
  );
  assert.ok(signupRecords.rows.every(row => row.accepted_at));

  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  const recorded = await db.query(
    `select public.record_legal_acceptances($1::jsonb, $2) as inserted`,
    [JSON.stringify([
      {
        document_type: 'personal_data_consent',
        document_version: '1.0',
        document_hash: '7bb19b50f9e9c190b8a46b87624fa9e300e794b0dbde2fbe73fe2ec9ecf8cd41',
      },
    ]), 'migration-test'],
  );
  assert.equal(recorded.rows[0].inserted, 1);

  const stored = await db.query(`
    select document_type, document_version, document_hash, source, accepted_at
    from public.user_consents
    where document_type = 'personal_data_consent'
  `);
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0].source, 'migration-test');
  assert.ok(stored.rows[0].accepted_at);

  const privilege = await db.query(`
    select
      has_function_privilege(
        'authenticated',
        'public.record_legal_acceptances(jsonb,text)',
        'EXECUTE'
      ) as can_execute,
      has_table_privilege('authenticated', 'public.user_consents', 'INSERT')
        as can_insert_directly
  `);
  assert.equal(privilege.rows[0].can_execute, true);
  assert.equal(privilege.rows[0].can_insert_directly, false);

  await db.close();
});
