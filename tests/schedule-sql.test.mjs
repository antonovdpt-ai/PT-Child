import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const user1 = '11111111-1111-4111-8111-111111111111';
const user2 = '22222222-2222-4222-8222-222222222222';
const patient = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const asJson = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const entry = (start, overrides = {}) => ({ patient_id:patient, initial_name:null, starts_at:start, ends_at:new Date(new Date(start).getTime()+3600000).toISOString(), kind:'appointment', status:'planned', price_kopecks:300000, paid_kopecks:0, note:null, ...overrides });

test('migration executes and schedule writes are isolated, atomic and debt-safe', async () => {
  const db = new PGlite({ extensions:{ btree_gist } });
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table public.patients(id uuid primary key, therapist_id uuid not null references auth.users(id), display_name text not null, created_at timestamptz default now());
      create table public.sessions(id uuid primary key default gen_random_uuid(), therapist_id uuid not null references auth.users(id), patient_id uuid references public.patients(id));
      create function public.account_is_active() returns boolean language sql stable as $$ select auth.uid() is not null $$;
      grant usage on schema public, auth to authenticated;
      grant select, update on public.patients to authenticated;
      grant select on public.sessions to authenticated;
      insert into auth.users values ('${user1}'),('${user2}');
      insert into public.patients(id,therapist_id,display_name) values ('${patient}','${user1}','Иван Тестов');
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20260923_005_specialist_schedule.sql', import.meta.url), 'utf8'));
    const migration006 = await readFile(new URL('../supabase/migrations/20260923_006_schedule_calendar.sql', import.meta.url), 'utf8');
    await db.exec(migration006);
    await db.exec(migration006); // safe when the server command is retried
    await db.exec(`set role authenticated; set "request.jwt.claim.sub"='${user1}'`);

    let result = await db.query(`select public.save_schedule_entries(${asJson([entry('2026-09-23T08:00:00Z')])}, true) as saved`);
    assert.equal(result.rows[0].saved, 1);
    result = await db.query(`select schedule_price_kopecks from public.patients where id='${patient}'`);
    assert.equal(result.rows[0].schedule_price_kopecks, 300000);

    await assert.rejects(db.query(`select public.save_schedule_entries(${asJson([entry('2026-09-23T10:00:00Z'), entry('2026-09-23T10:00:00Z')])}, false)`), /appointments_no_active_overlap|conflicting key/i);
    result = await db.query(`select count(*)::int as count from public.appointments`);
    assert.equal(result.rows[0].count, 1, 'the failed series must roll back every entry');

    await db.query(`select public.save_schedule_entries(${asJson([
      entry('2026-09-22T08:00:00Z', { status:'completed', price_kopecks:300000 }),
      entry('2026-09-24T08:00:00Z', { price_kopecks:250000 }),
      entry('2026-09-25T08:00:00Z', { price_kopecks:250000 })
    ])}, false)`);
    result = await db.query(`select id from public.appointments where starts_at='2026-09-24T08:00:00Z'`);
    const target = result.rows[0].id;
    result = await db.query(`select public.settle_schedule_patient('${target}',550000) as paid`);
    assert.equal(Number(result.rows[0].paid), 550000);
    result = await db.query(`select starts_at,paid_kopecks from public.appointments where patient_id='${patient}' order by starts_at`);
    assert.deepEqual(result.rows.map(r => r.paid_kopecks), [300000, 0, 250000, 0], 'selected visit and completed debt are paid, other future visit is untouched');

    await db.exec(`set "request.jwt.claim.sub"='${user2}'`);
    result = await db.query('select count(*)::int as count from public.appointments');
    assert.equal(result.rows[0].count, 0, 'RLS hides another specialist schedule');
  } finally { await db.close(); }
});
