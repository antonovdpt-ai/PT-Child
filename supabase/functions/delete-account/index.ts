import { createClient } from "jsr:@supabase/supabase-js@2";
import { allowedOrigin } from "../_shared/ai-helpers.ts";

const configuredOrigins =
  Deno.env.get("FIZIRA_ALLOWED_ORIGINS") || "https://app.fizira.com";

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(origin: string, status: number, body: unknown) {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(origin),
      "Cache-Control": "no-store",
    },
  });
}

function requiredEnv(name: string, fallback?: string): string {
  const value =
    Deno.env.get(name) ||
    (fallback ? Deno.env.get(fallback) : undefined);
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
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

Deno.serve(async (req) => {
  const origin = allowedOrigin(
    req.headers.get("Origin"),
    configuredOrigins,
  );
  if (!origin) {
    return Response.json({ error: "Origin not allowed" }, { status: 403 });
  }
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json(origin, 405, { error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(origin, 401, { error: "Unauthorized" });
    }

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = requiredEnv(
      "SUPABASE_SERVICE_ROLE_KEY",
      "SERVICE_ROLE_KEY",
    );
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const token = authHeader.slice("Bearer ".length);
    const { data: { user }, error: userError } =
      await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return json(origin, 401, { error: "Unauthorized" });
    }

    await deleteUserFiles(supabaseAdmin, "patient-media", user.id);
    await deleteUserFiles(supabaseAdmin, "specialist-logos", user.id);

    const { error: deleteUserError } =
      await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteUserError) throw deleteUserError;

    return json(origin, 200, { success: true });
  } catch (error) {
    console.error(
      "delete-account failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return json(origin, 500, { error: "Internal server error" });
  }
});
