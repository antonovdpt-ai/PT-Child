import { createClient } from "jsr:@supabase/supabase-js@2";
import { allowedOrigin } from "../_shared/ai-helpers.ts";

const configuredOrigins =
  Deno.env.get("FIZIRA_ALLOWED_ORIGINS") || "https://app.fizira.com";
const MAX_WORKER_BATCH = 20;

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-fizira-deletion-worker",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(origin: string, status: number, body: unknown) {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders(origin), "Cache-Control": "no-store" },
  });
}

function requiredEnv(name: string, fallback?: string): string {
  const value = Deno.env.get(name) ||
    (fallback ? Deno.env.get(fallback) : undefined);
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

function retryAt(attempt: number): string {
  const minutes = Math.min(24 * 60, 2 ** Math.min(attempt, 10));
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  if (!left || !right) return false;
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

async function getAllFiles(
  supabaseAdmin: any,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];

  async function walk(folder: string) {
    let offset = 0;
    while (true) {
      const { data, error } = await supabaseAdmin.storage
        .from(bucket)
        .list(folder, {
          limit: 1_000,
          offset,
          sortBy: { column: "name", order: "asc" },
        });
      if (error) throw error;
      if (!data?.length) break;

      for (const item of data) {
        const itemPath = folder ? `${folder}/${item.name}` : item.name;
        if (item.id) paths.push(itemPath);
        else await walk(itemPath);
      }

      if (data.length < 1_000) break;
      offset += 1_000;
    }
  }

  await walk(prefix);
  return paths;
}

async function deleteUserFiles(
  supabaseAdmin: any,
  bucket: string,
  userId: string,
) {
  const paths = await getAllFiles(supabaseAdmin, bucket, userId);
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await supabaseAdmin.storage
      .from(bucket)
      .remove(paths.slice(index, index + 100));
    if (error) throw error;
  }
}

async function processDeletion(supabaseAdmin: any, job: any) {
  const attempts = Number(job.attempts || 1);

  try {
    await deleteUserFiles(supabaseAdmin, "patient-media", job.user_id);
    await deleteUserFiles(supabaseAdmin, "specialist-logos", job.user_id);

    const { error: deleteUserError } =
      await supabaseAdmin.auth.admin.deleteUser(job.user_id, false);
    if (deleteUserError && deleteUserError.status !== 404) {
      throw deleteUserError;
    }

    // The tombstone blocks new writes. A second pass removes anything created
    // immediately before the tombstone became visible to concurrent requests.
    await deleteUserFiles(supabaseAdmin, "patient-media", job.user_id);
    await deleteUserFiles(supabaseAdmin, "specialist-logos", job.user_id);

    const { error: completeError } = await supabaseAdmin
      .from("account_deletion_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        next_retry_at: new Date().toISOString(),
        last_error_code: null,
      })
      .eq("user_id", job.user_id);
    if (completeError) throw completeError;
    return true;
  } catch (error) {
    await supabaseAdmin
      .from("account_deletion_jobs")
      .update({
        status: "retry",
        updated_at: new Date().toISOString(),
        next_retry_at: retryAt(attempts),
        last_error_code:
          error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
      })
      .eq("user_id", job.user_id);
    return false;
  }
}

async function processDueJobs(supabaseAdmin: any) {
  const { data: jobs, error } = await supabaseAdmin
    .rpc("claim_account_deletion_jobs", {
      p_batch_limit: MAX_WORKER_BATCH,
      p_target_user_id: null,
    });
  if (error) throw error;

  let completed = 0;
  for (const job of jobs ?? []) {
    if (await processDeletion(supabaseAdmin, job)) completed += 1;
  }
  return { processed: jobs?.length ?? 0, completed };
}

Deno.serve(async (req) => {
  const origin = allowedOrigin(req.headers.get("Origin"), configuredOrigins);
  const workerSecret = Deno.env.get("FIZIRA_DELETION_WORKER_SECRET") || "";
  const suppliedWorkerSecret =
    req.headers.get("X-Fizira-Deletion-Worker") || "";
  const isWorker = await constantTimeEqual(
    suppliedWorkerSecret,
    workerSecret,
  );

  if (!isWorker && !origin) {
    return Response.json({ error: "Origin not allowed" }, { status: 403 });
  }
  const responseOrigin = origin || configuredOrigins.split(",")[0].trim();
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(responseOrigin) });
  }
  if (req.method !== "POST") {
    return json(responseOrigin, 405, { error: "Method not allowed" });
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY", "ANON_KEY");
    const serviceRoleKey = requiredEnv(
      "SUPABASE_SERVICE_ROLE_KEY",
      "SERVICE_ROLE_KEY",
    );
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (isWorker) {
      const result = await processDueJobs(supabaseAdmin);
      return json(responseOrigin, 200, { success: true, ...result });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(responseOrigin, 401, { error: "Unauthorized" });
    }
    const token = authHeader.slice("Bearer ".length);
    const { data: { user }, error: userError } =
      await supabaseAdmin.auth.getUser(token);
    if (userError || !user?.email) {
      return json(responseOrigin, 401, { error: "Unauthorized" });
    }

    const body = await req.json().catch(() => null);
    const password = typeof body?.password === "string"
      ? body.password
      : "";
    if (!password || password.length > 1_024) {
      return json(responseOrigin, 400, {
        error: "Password confirmation is required",
      });
    }

    const verifier = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: passwordError } = await verifier.auth.signInWithPassword({
      email: user.email,
      password,
    });
    if (passwordError) {
      return json(responseOrigin, 403, {
        error: "Password confirmation failed",
      });
    }

    const { error: jobError } = await supabaseAdmin
      .from("account_deletion_jobs")
      .upsert({
        user_id: user.id,
        status: "pending",
        requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
        next_retry_at: new Date().toISOString(),
        last_error_code: null,
      }, { onConflict: "user_id" });
    if (jobError) throw jobError;

    // Revoke refresh tokens before destructive work. Existing short-lived JWTs
    // are immediately neutralized by the restrictive tombstone policies.
    await verifier.auth.signOut({ scope: "global" }).catch(() => undefined);

    const { data: claimedJobs, error: claimError } = await supabaseAdmin
      .rpc("claim_account_deletion_jobs", {
        p_batch_limit: 1,
        p_target_user_id: user.id,
      });
    if (claimError) throw claimError;

    const job = claimedJobs?.[0];
    const completed = job
      ? await processDeletion(supabaseAdmin, job)
      : false;
    return json(responseOrigin, completed ? 200 : 202, {
      success: true,
      pending: !completed,
    });
  } catch (error) {
    console.error(
      "delete-account failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return json(responseOrigin, 500, { error: "Internal server error" });
  }
});
