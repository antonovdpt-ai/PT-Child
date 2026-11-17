import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const patient = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secondPatient = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const foreignPatient = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const migration = name => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8')
  .then(sql => sql.replace(/^\\set .*$/gm, ''));

const entry = (starts_at, overrides = {}) => ({
  patient_id: patient,
  starts_at,
  ends_at: new Date(Date.parse(starts_at) + 30 * 60_000).toISOString(),
  kind: 'appointment',
  status: 'planned',
  price_kopecks: 300000,
  paid_kopecks: 0,
  schedule_timezone: 'Europe/Moscow',
  ...overrides
});

test('scheduled history is atomic, recoverable, isolated and compatible with legacy records', async () => {
  const db = new PGlite({ extensions: { btree_gist } });
  const query = (sql, args = []) => db.query(sql, args);
  const one = async (sql, args) => (await query(sql, args)).rows[0];
  const save = (...entries) => query('select public.save_schedule_entries($1, false)', [JSON.stringify(entries.map(entry => ({ confirm_completed: true, ...entry })))]);
  const appointment = start => one('select *, updated_at::text as db_updated_at from appointments where starts_at = $1', [start]);
  const session = id => one('select * from sessions where id = $1', [id]);
  const revise = (row, changes = {}) => ({ ...row, ...changes, expected_updated_at: row.db_updated_at });
  const as = async user => {
    await db.exec('reset role');
    if (user) await db.exec(`set role authenticated; set "request.jwt.claim.sub" = '${user}'`);
    else await db.exec('reset "request.jwt.claim.sub"');
  };

  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
      create schema storage;
      create table storage.buckets(id text primary key, name text, public boolean);
      create table storage.objects(bucket_id text, name text);
      create function storage.foldername(name text) returns text[] language sql immutable as
        $$ select string_to_array(name, '/') $$;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    `);
    await db.exec(await migration('20260920_001_app_schema'));
    await db.exec(`
      create function public.account_is_active() returns boolean language sql stable as $$ select auth.uid() is not null $$;
      grant usage on schema public, auth to authenticated;
      grant select, insert, update, delete on public.patients, public.sessions to authenticated;
      insert into auth.users (id) values ('${owner}'), ('${other}');
      insert into patients (id, therapist_id, display_name) values
        ('${patient}', '${owner}', 'Тест 1'),
        ('${secondPatient}', '${owner}', 'Тест 2'),
        ('${foreignPatient}', '${other}', 'Тест 3');
    `);
    await db.exec(await migration('20260923_005_specialist_schedule'));
    await db.exec(await migration('20260923_006_schedule_calendar'));

    const manual = await one(`insert into sessions (patient_id, therapist_id, session_date, note)
      values ($1, $2, '2026-11-01', 'Ручное наблюдение') returning *`, [patient, owner]);
    const legacyLink = await one(`insert into sessions (patient_id, therapist_id, session_date, note)
      values ($1, $2, '2026-11-01', 'Известная связь') returning *`, [patient, owner]);
    const legacyStart = '2026-10-31T22:00:00.000Z';
    const linkedStart = '2026-10-31T23:00:00.000Z';
    await query(`insert into appointments (therapist_id, patient_id, starts_at, ends_at, status, session_id)
      values ($1, $2, $3::timestamptz, $3::timestamptz + interval '30 minutes', 'completed', null),
             ($1, $2, $4::timestamptz, $4::timestamptz + interval '30 minutes', 'completed', $5)`,
      [owner, patient, legacyStart, linkedStart, legacyLink.id]);

    const legacyIntake = '2026-11-01T05:00:00.000Z';
    await query(`insert into appointments (therapist_id, starts_at, ends_at, status)
      values ($1, $2::timestamptz, $2::timestamptz + interval '30 minutes', 'completed')`, [owner, legacyIntake]);

    const sql = await migration('20261112_008_auto_session_history');
    await db.exec(sql);
    assert.equal((await session(manual.id)).origin, 'manual');
    assert.equal((await session(legacyLink.id)).origin, 'manual', 'migration does not change existing clinical records');
    await as(owner);

    let legacy = await appointment(legacyStart);
    await save(revise(legacy, { paid_kopecks: 0 }));
    legacy = await appointment(legacyStart);
    assert.equal(legacy.session_id, null, 'saving an old completed visit must not create a duplicate of a manual record');
    await save(revise(legacy, { status: 'planned' }));
    await save(revise(await appointment(legacyStart), { status: 'completed' }));
    assert.equal((await appointment(legacyStart)).session_id, null, 'historical review survives status changes');

    await save(revise(await appointment(legacyIntake), { patient_id: secondPatient }));
    assert.equal((await appointment(legacyIntake)).session_id, null, 'old completed initial visits still need review');

    const start = '2026-11-30T21:15:00.000Z';
    await save(entry(start));
    let row = await appointment(start);
    assert.equal(row.session_id, null);
    await assert.rejects(save(revise(row, { status: 'completed', confirm_completed: false })), /SCHEDULE_CONFIRM_COMPLETED/);
    await save(revise(row, { status: 'completed' }));
    row = await appointment(start);
    const id = row.session_id;
    assert.ok(id);
    let record = await session(id);
    assert.equal(record.origin, 'schedule');
    assert.equal(record.scheduled_at.toISOString(), start);
    assert.equal(record.session_date.toISOString().slice(0, 10), '2026-12-01');
    assert.equal(record.note, null);
    assert.equal(record.planned_session, null);
    assert.equal(record.has_clinical_data, false);
    await query("update sessions set note = '  ' || chr(9), dynamics_status = 'unclear' where id = $1", [id]);
    assert.equal((await session(id)).has_clinical_data, false);
    await query("update sessions set note = 'Сделал три шага', tolerance = 'good' where id = $1", [id]);
    assert.equal((await session(id)).has_clinical_data, true);

    const edited = entry('2026-12-01T08:25:00.000Z', { status: 'completed', schedule_timezone: 'Asia/Yekaterinburg' });
    await save(revise(row, edited));
    const moved = await appointment(edited.starts_at);
    assert.equal(moved.session_id, id);
    assert.equal((await session(id)).scheduled_at.toISOString(), edited.starts_at);
    assert.equal((await session(id)).schedule_timezone, 'Asia/Yekaterinburg');
    await assert.rejects(save(revise(row, edited)), /SCHEDULE_STALE/);
    await save(revise(moved));
    assert.equal((await appointment(edited.starts_at)).session_id, id);
    assert.equal((await one("select count(*)::int as count from sessions where origin = 'schedule'")).count, 1);

    for (const status of ['cancelled', 'planned', 'no_show']) {
      await save(revise(await appointment(edited.starts_at), { status }));
      assert.ok((await session(id)).voided_at);
      assert.equal((await session(id)).note, 'Сделал три шага');
      await assert.rejects(query("update sessions set note = 'Опоздавшее изменение' where id = $1", [id]), /SESSION_VOIDED/);
      await save(revise(await appointment(edited.starts_at), { status: 'completed' }));
      assert.equal((await appointment(edited.starts_at)).session_id, id);
      assert.equal((await session(id)).voided_at, null);
    }

    await assert.rejects(save(revise(await appointment(edited.starts_at), { patient_id: secondPatient })), /SCHEDULE_SESSION_PATIENT/);
    await assert.rejects(save(entry('2026-12-02T08:00:00.000Z', { patient_id: foreignPatient, status: 'completed' })), /SCHEDULE_PATIENT_OWNER/);
    await assert.rejects(query("update sessions set session_date = '2027-01-01' where id = $1", [id]), /SESSION_SCHEDULE_MANAGED/);
    await assert.rejects(query('update appointments set session_id = $1 where id = $2', [manual.id, moved.id]), /SCHEDULE_SESSION_LINK/);
    await assert.rejects(query('update appointments set history_review_required = false where starts_at = $1', [legacyStart]), /SCHEDULE_SESSION_LINK/);
    await assert.rejects(query('delete from sessions where id = $1', [id]), /SESSION_SCHEDULE_MANAGED/);

    const intake = entry('2026-12-03T08:00:00.000Z', { patient_id: null, status: 'completed', initial_name: 'Первичный тест' });
    await save(intake);
    assert.equal((await appointment(intake.starts_at)).session_id, null);
    await save(revise(await appointment(intake.starts_at), { patient_id: secondPatient, initial_name: null }));
    assert.equal((await session((await appointment(intake.starts_at)).session_id)).patient_id, secondPatient);

    await save(entry('2026-12-04T08:00:00.000Z', { kind: 'break', patient_id: null, status: 'completed' }));
    assert.equal((await appointment('2026-12-04T08:00:00.000Z')).session_id, null);
    const colliding = entry('2026-12-05T08:00:00.000Z', { status: 'completed' });
    await assert.rejects(save(colliding, colliding), /appointments_no_active_overlap|conflicting key/);
    assert.equal(await appointment(colliding.starts_at), undefined);
    assert.equal((await one("select count(*)::int as count from sessions where origin = 'schedule'")).count, 2);
    await assert.rejects(save({ ...colliding, schedule_timezone: 'Bad/Zone' }), /SCHEDULE_TIME_ZONE/);

    const payment = await one('select settle_schedule_patient($1, 300000) as paid', [moved.id]);
    assert.equal(Number(payment.paid), 300000);
    assert.equal((await appointment(edited.starts_at)).session_id, id);

    await as(other);
    assert.equal(await session(id), undefined);
    assert.equal(await appointment(edited.starts_at), undefined);
    await assert.rejects(save(revise(moved)), /SCHEDULE_STALE/);

    await as(owner);
    await query('delete from appointments where id = $1', [moved.id]);
    assert.ok((await session(id)).voided_at);
    assert.equal((await session(id)).note, 'Сделал три шага');
    await query('delete from patients where id = $1', [secondPatient]);
    assert.equal((await appointment(intake.starts_at)).session_id, null);
    assert.equal((await appointment(intake.starts_at)).patient_id, null);

    await as(null);
    const backfill = await readFile(new URL('../ops/schedule/session-history-apply.sql', import.meta.url), 'utf8');
    const backfillSql = backfill.replace('-- Add reviewed rows here.', `
      insert into session_history_review
      select a.id, v.session_id, a.patient_id, a.status, a.starts_at, 'Europe/Moscow', a.updated_at, s.updated_at
      from (values ('${legacy.id}'::uuid, '${manual.id}'::uuid),
        ((select id from appointments where starts_at = '${linkedStart}'), '${legacyLink.id}'::uuid)) v(appointment_id, session_id)
      join appointments a on a.id = v.appointment_id
      join sessions s on s.id = v.session_id;
    `).replace(/rollback;\s*$/i, 'commit;');
    await assert.rejects(db.exec(backfillSql.replace('a.updated_at, s.updated_at', "a.updated_at, s.updated_at - interval '1 day'")), /no longer matches/);
    await db.exec('rollback');
    await db.exec(backfillSql);
    assert.equal((await appointment(legacyStart)).session_id, manual.id);
    assert.equal((await session(manual.id)).origin, 'schedule');
    assert.equal((await session(manual.id)).note, 'Ручное наблюдение');
    assert.equal((await session(legacyLink.id)).origin, 'schedule');
    await db.exec(backfillSql);
    assert.equal((await appointment(legacyStart)).session_id, manual.id);
    const audit = await readFile(new URL('../ops/schedule/session-history-audit.sql', import.meta.url), 'utf8');
    await db.exec(audit);

    await query(`insert into appointments (therapist_id, patient_id, starts_at, ends_at, status)
      select $1, $2, starts, starts + interval '30 minutes', 'completed'
      from generate_series('2027-01-01 08:00Z'::timestamptz, '2027-03-01 08:00Z', '1 day') starts`, [owner, patient]);
    await as(owner);
    const clinical = await query(`select id from sessions where patient_id = $1 and voided_at is null
      and has_clinical_data order by session_date desc, scheduled_at desc nulls last, created_at desc, id limit 3`, [patient]);
    assert.deepEqual(new Set(clinical.rows.map(row => row.id)), new Set([manual.id, legacyLink.id]),
      'many newer empty visits and a voided clinical session do not crowd out older notes');
    assert.equal((await one('select count(*)::int as n from sessions where patient_id = $1 and voided_at is null', [patient])).n, 62);
  } finally {
    await db.close();
  }
});
