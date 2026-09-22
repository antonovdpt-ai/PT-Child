#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

const baseUrl = required('SUPABASE_URL').replace(/\/$/, '');
const anonKey = process.env.SUPABASE_ANON_KEY || required('ANON_KEY');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || required('SERVICE_ROLE_KEY');
const workerSecret = required('FIZIRA_DELETION_WORKER_SECRET');
const origin = process.env.FIZIRA_TEST_ORIGIN || 'https://app.fizira.com';
const password = `Fz-${randomBytes(24).toString('base64url')}!9a`;
const email = `fizira-delete-${Date.now()}-${randomUUID()}@example.invalid`;

let userId = '';
let patientId = '';
let storagePath = '';

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
    try { body = JSON.parse(text); } catch { body = text; }
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

async function queryRows(table, query) {
  const { response, body } = await request(`/rest/v1/${table}?${query}`, {
    headers: serviceHeaders(),
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

async function cleanup() {
  if (storagePath) {
    await request(`/storage/v1/object/patient-media/${storagePath}`, {
      method: 'DELETE',
      headers: serviceHeaders(),
    }).catch(() => undefined);
  }
  if (userId) {
    await request(`/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: serviceHeaders(),
    }).catch(() => undefined);
    await request(`/rest/v1/account_deletion_jobs?user_id=eq.${userId}`, {
      method: 'DELETE',
      headers: serviceHeaders({ Prefer: 'return=minimal' }),
    }).catch(() => undefined);
  }
}

try {
  const created = await request('/auth/v1/admin/users', {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  assert.ok(
    [200, 201].includes(created.response.status),
    JSON.stringify(created.body),
  );
  userId = created.body.id;
  assert.match(userId, /^[0-9a-f-]{36}$/i);

  const signedIn = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(signedIn.response.status, 200, JSON.stringify(signedIn.body));
  const accessToken = signedIn.body.access_token;
  assert.ok(accessToken);

  const userHeaders = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  const insertedPatient = await request('/rest/v1/patients', {
    method: 'POST',
    headers: { ...userHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({ display_name: 'Synthetic deletion test' }),
  });
  assert.equal(insertedPatient.response.status, 201, JSON.stringify(insertedPatient.body));
  patientId = insertedPatient.body[0].id;

  storagePath = `${userId}/${patientId}/synthetic.png`;
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const uploaded = await request(`/storage/v1/object/patient-media/${storagePath}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'image/png',
      'x-upsert': 'false',
    },
    body: onePixelPng,
  });
  assert.ok([200, 201].includes(uploaded.response.status), JSON.stringify(uploaded.body));

  const insertedMedia = await request('/rest/v1/patient_media', {
    method: 'POST',
    headers: { ...userHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({
      patient_id: patientId,
      therapist_id: userId,
      storage_path: storagePath,
      media_type: 'image',
      category: 'posture',
    }),
  });
  assert.equal(insertedMedia.response.status, 201, JSON.stringify(insertedMedia.body));

  const wrongPassword = await request('/functions/v1/delete-account', {
    method: 'POST',
    headers: {
      ...userHeaders,
      Origin: origin,
    },
    body: JSON.stringify({ password: `${password}-wrong` }),
  });
  assert.equal(wrongPassword.response.status, 403, JSON.stringify(wrongPassword.body));
  assert.equal(
    (await queryRows('account_deletion_jobs', `select=user_id&user_id=eq.${userId}`)).length,
    0,
    'wrong password created a deletion tombstone',
  );

  const deletion = await request('/functions/v1/delete-account', {
    method: 'POST',
    headers: {
      ...userHeaders,
      Origin: origin,
    },
    body: JSON.stringify({ password }),
  });
  assert.ok([200, 202].includes(deletion.response.status), JSON.stringify(deletion.body));
  assert.equal(deletion.body.success, true);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const jobs = await queryRows(
      'account_deletion_jobs',
      `select=status,attempts,last_error_code&user_id=eq.${userId}`,
    );
    if (jobs[0]?.status === 'completed') break;
    const worker = await request('/functions/v1/delete-account', {
      method: 'POST',
      headers: serviceHeaders({
        'Content-Type': 'application/json',
        'X-Fizira-Deletion-Worker': workerSecret,
      }),
      body: '{}',
    });
    assert.equal(worker.response.status, 200, JSON.stringify(worker.body));
  }

  const jobs = await queryRows(
    'account_deletion_jobs',
    `select=status,attempts,last_error_code&user_id=eq.${userId}`,
  );
  assert.equal(jobs[0]?.status, 'completed', JSON.stringify(jobs));
  assert.equal(
    (await queryRows('patients', `select=id&therapist_id=eq.${userId}`)).length,
    0,
    'patient rows survived hard deletion',
  );

  const userLookup = await request(`/auth/v1/admin/users/${userId}`, {
    headers: serviceHeaders(),
  });
  assert.equal(userLookup.response.status, 404, JSON.stringify(userLookup.body));

  const fileLookup = await request(`/storage/v1/object/info/patient-media/${storagePath}`, {
    headers: serviceHeaders(),
  });
  assert.ok(
    [400, 404].includes(fileLookup.response.status) &&
      ['not_found', 'NoSuchKey'].includes(
        fileLookup.body?.error || fileLookup.body?.code,
      ),
    JSON.stringify(fileLookup.body),
  );

  const staleWrite = await request('/rest/v1/patients', {
    method: 'POST',
    headers: { ...userHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({ display_name: 'Must be rejected' }),
  });
  assert.ok(staleWrite.response.status >= 400, JSON.stringify(staleWrite.body));

  console.log(
    `ACCOUNT_DELETION_SYNTHETIC_OK user=${userId} attempts=${jobs[0].attempts}`,
  );
} finally {
  await cleanup();
}
