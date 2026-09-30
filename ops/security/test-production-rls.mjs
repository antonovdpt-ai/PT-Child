#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

const confirmation = process.env.FIZIRA_RLS_E2E_CONFIRM;
if (confirmation !== 'synthetic-production-test') {
  throw new Error(
    'Refusing to run: set FIZIRA_RLS_E2E_CONFIRM=synthetic-production-test',
  );
}

const baseUrl = required('SUPABASE_URL').replace(/\/$/, '');
const anonKey = process.env.SUPABASE_ANON_KEY || required('ANON_KEY');
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || required('SERVICE_ROLE_KEY');
const password = `Fz-${randomBytes(24).toString('base64url')}!9a`;
const runId = `${Date.now()}-${randomUUID()}`;
const testDate = new Date().toISOString().slice(0, 10);
const users = [];
const patients = [];
const storagePaths = [];

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { response, body };
}

function serviceHeaders(extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...extra,
  };
}

function userHeaders(token, extra = {}) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function encodeStoragePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function createUser(label) {
  const email = `fizira-rls-${label}-${runId}@example.invalid`;
  const created = await request('/auth/v1/admin/users', {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Synthetic RLS ${label}` },
    }),
  });
  assert.ok([200, 201].includes(created.response.status), JSON.stringify(created.body));
  assert.match(created.body.id, /^[0-9a-f-]{36}$/i);
  users.push(created.body.id);

  const signedIn = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(signedIn.response.status, 200, JSON.stringify(signedIn.body));
  assert.ok(signedIn.body.access_token);
  return { id: created.body.id, token: signedIn.body.access_token };
}

async function insertRow(table, token, body) {
  const result = await request(`/rest/v1/${table}`, {
    method: 'POST',
    headers: userHeaders(token, { Prefer: 'return=representation' }),
    body: JSON.stringify(body),
  });
  assert.equal(result.response.status, 201, `${table}: ${JSON.stringify(result.body)}`);
  assert.equal(result.body.length, 1, table);
  return result.body[0];
}

async function selectById(table, id, token) {
  const result = await request(
    `/rest/v1/${table}?select=id&id=eq.${encodeURIComponent(id)}`,
    { headers: userHeaders(token) },
  );
  assert.equal(result.response.status, 200, `${table}: ${JSON.stringify(result.body)}`);
  assert.ok(Array.isArray(result.body), table);
  return result.body;
}

async function cleanup() {
  for (const path of storagePaths.reverse()) {
    await request(`/storage/v1/object/patient-media/${encodeStoragePath(path)}`, {
      method: 'DELETE',
      headers: serviceHeaders(),
    }).catch(() => undefined);
  }
  for (const patientId of patients.reverse()) {
    await request(`/rest/v1/patients?id=eq.${patientId}`, {
      method: 'DELETE',
      headers: serviceHeaders({ Prefer: 'return=minimal' }),
    }).catch(() => undefined);
  }
  for (const userId of users.reverse()) {
    await request(`/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: serviceHeaders(),
    }).catch(() => undefined);
  }
}

try {
  const specialistA = await createUser('a');
  const specialistB = await createUser('b');

  const patientA = await insertRow('patients', specialistA.token, {
    display_name: 'Synthetic patient A',
  });
  const patientB = await insertRow('patients', specialistB.token, {
    display_name: 'Synthetic patient B',
  });
  patients.push(patientA.id, patientB.id);

  const storagePath = `${specialistA.id}/${patientA.id}/rls-test.png`;
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const uploaded = await request(
    `/storage/v1/object/patient-media/${encodeStoragePath(storagePath)}`,
    {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${specialistA.token}`,
        'Content-Type': 'image/png',
        'x-upsert': 'false',
      },
      body: onePixelPng,
    },
  );
  assert.ok([200, 201].includes(uploaded.response.status), JSON.stringify(uploaded.body));
  storagePaths.push(storagePath);

  const rows = new Map();
  rows.set('patients', patientA);
  rows.set('profiles', { id: specialistA.id });
  rows.set(
    'patient_contacts',
    await insertRow('patient_contacts', specialistA.token, {
      patient_id: patientA.id,
      therapist_id: specialistA.id,
      full_name: 'Synthetic contact',
      relation: 'test',
    }),
  );
  rows.set(
    'assessments',
    await insertRow('assessments', specialistA.token, {
      patient_id: patientA.id,
      complaint: 'Synthetic complaint',
    }),
  );
  rows.set(
    'goals',
    await insertRow('goals', specialistA.token, {
      patient_id: patientA.id,
      title: 'Synthetic goal',
    }),
  );
  rows.set(
    'sessions',
    await insertRow('sessions', specialistA.token, {
      patient_id: patientA.id,
      note: 'Synthetic session',
    }),
  );
  rows.set(
    'standardized_assessments',
    await insertRow('standardized_assessments', specialistA.token, {
      patient_id: patientA.id,
      therapist_id: specialistA.id,
      scale: 'other',
      value_text: 'synthetic',
      assessed_at: testDate,
    }),
  );
  rows.set(
    'parent_reports',
    await insertRow('parent_reports', specialistA.token, {
      patient_id: patientA.id,
      therapist_id: specialistA.id,
      observations: 'Synthetic report',
    }),
  );
  rows.set(
    'ai_analysis_history',
    await insertRow('ai_analysis_history', specialistA.token, {
      patient_id: patientA.id,
      therapist_id: specialistA.id,
      analysis: 'Synthetic analysis',
    }),
  );
  rows.set(
    'patient_media',
    await insertRow('patient_media', specialistA.token, {
      patient_id: patientA.id,
      therapist_id: specialistA.id,
      storage_path: storagePath,
      media_type: 'image',
      category: 'other',
    }),
  );
  rows.set(
    'user_consents',
    await insertRow('user_consents', specialistA.token, {
      user_id: specialistA.id,
      terms_version: `synthetic-${runId}`,
      privacy_version: `synthetic-${runId}`,
    }),
  );

  for (const [table, row] of rows) {
    assert.equal((await selectById(table, row.id, specialistA.token)).length, 1, table);
    assert.equal(
      (await selectById(table, row.id, specialistB.token)).length,
      0,
      `${table} leaked across specialists`,
    );
  }

  const crossUpdate = await request(
    `/rest/v1/patients?id=eq.${patientA.id}`,
    {
      method: 'PATCH',
      headers: userHeaders(specialistB.token, { Prefer: 'return=representation' }),
      body: JSON.stringify({ primary_complaint: 'Must not be written' }),
    },
  );
  assert.equal(crossUpdate.response.status, 200, JSON.stringify(crossUpdate.body));
  assert.deepEqual(crossUpdate.body, [], 'cross-user update changed a patient');

  const crossDelete = await request(
    `/rest/v1/patients?id=eq.${patientA.id}`,
    {
      method: 'DELETE',
      headers: userHeaders(specialistB.token, { Prefer: 'return=representation' }),
    },
  );
  assert.equal(crossDelete.response.status, 200, JSON.stringify(crossDelete.body));
  assert.deepEqual(crossDelete.body, [], 'cross-user delete removed a patient');
  assert.equal((await selectById('patients', patientA.id, specialistA.token)).length, 1);

  const spoofedOwner = await request('/rest/v1/patients', {
    method: 'POST',
    headers: userHeaders(specialistB.token, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      therapist_id: specialistA.id,
      display_name: 'Must be rejected',
    }),
  });
  assert.ok(spoofedOwner.response.status >= 400, JSON.stringify(spoofedOwner.body));

  const crossRelation = await request('/rest/v1/patient_contacts', {
    method: 'POST',
    headers: userHeaders(specialistB.token, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      patient_id: patientA.id,
      therapist_id: specialistB.id,
      full_name: 'Must be rejected',
    }),
  });
  assert.ok(crossRelation.response.status >= 400, JSON.stringify(crossRelation.body));

  const mismatchedStoragePath = await request('/rest/v1/patient_media', {
    method: 'POST',
    headers: userHeaders(specialistB.token, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      patient_id: patientB.id,
      therapist_id: specialistB.id,
      storage_path: storagePath,
      media_type: 'image',
      category: 'other',
    }),
  });
  assert.ok(
    mismatchedStoragePath.response.status >= 400,
    JSON.stringify(mismatchedStoragePath.body),
  );

  const ownDownload = await request(
    `/storage/v1/object/patient-media/${encodeStoragePath(storagePath)}`,
    { headers: userHeaders(specialistA.token) },
  );
  assert.equal(ownDownload.response.status, 200, JSON.stringify(ownDownload.body));

  const crossDownload = await request(
    `/storage/v1/object/patient-media/${encodeStoragePath(storagePath)}`,
    { headers: userHeaders(specialistB.token) },
  );
  assert.ok(crossDownload.response.status >= 400, 'cross-user Storage download succeeded');

  const crossUpload = await request(
    `/storage/v1/object/patient-media/${encodeStoragePath(`${specialistA.id}/${patientA.id}/cross.png`)}`,
    {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${specialistB.token}`,
        'Content-Type': 'image/png',
        'x-upsert': 'false',
      },
      body: onePixelPng,
    },
  );
  assert.ok(crossUpload.response.status >= 400, 'cross-user Storage upload succeeded');

  const anonRows = await request('/rest/v1/patients?select=id&limit=1', {
    headers: { apikey: anonKey },
  });
  assert.ok(
    [401, 403].includes(anonRows.response.status) ||
      (anonRows.response.status === 200 && Array.isArray(anonRows.body) && anonRows.body.length === 0),
    `anonymous database read succeeded: ${JSON.stringify(anonRows.body)}`,
  );

  const anonDownload = await request(
    `/storage/v1/object/patient-media/${encodeStoragePath(storagePath)}`,
    { headers: { apikey: anonKey } },
  );
  assert.ok(anonDownload.response.status >= 400, 'anonymous Storage download succeeded');

  console.log(
    `RLS_AUTH_STORAGE_SYNTHETIC_OK tables=${rows.size} cross_writes=5 storage=4 anon=2`,
  );
} finally {
  await cleanup();
}
