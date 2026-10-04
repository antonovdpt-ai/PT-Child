import { allowedOrigin } from "./ai-helpers.ts";

const PUBLIC_ERROR = "Request could not be completed";
export class ParentPublicError extends Error {
  status: number;
  constructor(status = 400) { super(PUBLIC_ERROR); this.status = status; }
}
export function normalizeParentEmail(value: unknown): string {
  if (typeof value !== "string") throw new ParentPublicError();
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ParentPublicError();
  return email;
}
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new ParentPublicError();
  return value;
}
export async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
export function parentCors(origin: string | null, configured = "https://app.fizira.com") {
  const accepted = allowedOrigin(origin, configured);
  return accepted ? {
    "Access-Control-Allow-Origin": accepted,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  } : null;
}
export function parentJson(origin: string | null, status: number, body: unknown) {
  return Response.json(body, { status, headers: {
    ...(origin ? parentCors(origin, origin) : {}), "Vary": "Origin", "Cache-Control": "no-store",
  } });
}
type Operation = "create" | "resend" | "revoke";
type Dependencies = { env: (name: string) => string | undefined; createClient: (...args: any[]) => any };
async function requestBody(request: Request, keys: readonly string[]): Promise<Record<string, string>> {
  // Read a bounded stream rather than allocating an unbounded body first.
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ParentPublicError();
  const reader = request.body?.getReader();
  if (!reader) throw new ParentPublicError();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1024) { await reader.cancel(); throw new ParentPublicError(); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== keys.length || Object.keys(body).some(key => !keys.includes(key))) throw new ParentPublicError();
    for (const key of keys) uuid(body[key]);
    return body;
  } catch { throw new ParentPublicError(); } finally { reader.releaseLock(); }
}
async function ownedRow(client: any, table: string, columns: string, filters: Record<string, string>) {
  let query = client.from(table).select(columns);
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
  const { data, error } = await query.single();
  if (error || !data) throw new ParentPublicError(403);
  return data;
}
async function authorizeOwnership(client: any, userId: string, operation: Operation, body: Record<string,string>) {
  const active = await client.rpc("account_is_active");
  if (active.error || active.data !== true) throw new ParentPublicError(403);
  const roles = await client.rpc("current_app_roles");
  if (roles.error || !Array.isArray(roles.data) || !roles.data.some((row: any) => row.role === "specialist")) throw new ParentPublicError(403);
  let patientId = body.patient_id; let contactId = body.contact_id;
  if (operation !== "create") {
    const row = await ownedRow(client, operation === "resend" ? "parent_invitations" : "parent_child_access",
      operation === "resend" ? "id,patient_id,contact_id,accepted_at,revoked_at" : "id,patient_id,contact_id", { id: operation === "resend" ? body.invitation_id : body.access_id, therapist_id: userId });
    patientId = uuid(row.patient_id); contactId = row.contact_id;
    if (operation === "resend" && (row.accepted_at !== null || row.revoked_at !== null)) throw new ParentPublicError(403);
  }
  await ownedRow(client, "patients", "id", { id: patientId, therapist_id: userId });
  // A deleted contact may be null on existing access; revocation must still work.
  let email: string | undefined;
  if (contactId) {
    const contact = await ownedRow(client, "patient_contacts", "id,email", { id: uuid(contactId), patient_id: patientId, therapist_id: userId });
    if (operation !== "revoke") email = normalizeParentEmail(contact.email);
  } else if (operation !== "revoke") throw new ParentPublicError(403);
  return { patientId, contactId, email };
}
async function existingAddress(admin: any, email: string): Promise<boolean> {
  // Supabase JS listUsers is paginated, not an email-filter API. Never infer
  // existence from ambiguous invite/OTP errors or return user records.
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !Array.isArray(data?.users)) throw new Error(PUBLIC_ERROR);
    if (data.users.some((user: any) => typeof user.email === "string" && user.email.trim().toLowerCase() === email)) return true;
    if (data.users.length < 1000) return false;
  }
}
export function parentHandler(operation: Operation, keys: readonly string[], deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const cors = parentCors(request.headers.get("origin"), deps.env("FIZIRA_ALLOWED_ORIGINS") || "https://app.fizira.com");
    const origin = cors?.["Access-Control-Allow-Origin"] || null;
    try {
      if (!cors) throw new ParentPublicError(403);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Cache-Control": "no-store" } });
      if (request.method !== "POST") throw new ParentPublicError(405);
      const authorization = request.headers.get("authorization");
      if (!authorization || !/^Bearer [^\s]+$/i.test(authorization)) throw new ParentPublicError(401);
      const body = await requestBody(request, keys);
      const required = (name: string, fallback?: string) => {
        const value = deps.env(name) || (fallback ? deps.env(fallback) : undefined);
        if (!value) throw new Error(PUBLIC_ERROR); return value;
      };
      const url = required("SUPABASE_URL");
      const authOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit" };
      const userClient = deps.createClient(url, required("SUPABASE_ANON_KEY", "ANON_KEY"), { auth: authOptions, global: { headers: { Authorization: authorization } } });
      const user = await userClient.auth.getUser(authorization.slice(7));
      if (user.error || !user.data?.user?.id) throw new ParentPublicError(401);
      const userId = uuid(user.data.user.id);
      const owned = await authorizeOwnership(userClient, userId, operation, body);
      const admin = deps.createClient(url, required("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY"), { auth: authOptions });
      if (operation === "revoke") {
        const result = await admin.rpc("revoke_parent_access_record", { p_therapist_id: userId, p_access_id: body.access_id });
        if (result.error || !Number.isInteger(result.data) || result.data < 0 || result.data > 1) throw new Error(PUBLIC_ERROR);
        return parentJson(origin, 200, { ok: true });
      }
      const email = owned.email!;
      const existing = await existingAddress(admin, email);
      const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
      const issued = await admin.rpc("issue_parent_invitation_record", {
        p_therapist_id: userId, p_patient_id: owned.patientId, p_contact_id: owned.contactId,
        p_token_digest: await sha256Hex(token), p_auth_flow: existing ? "existing" : "new",
      });
      const record = issued.data?.[0];
      if (issued.error || !Array.isArray(issued.data) || issued.data.length !== 1 || !record || typeof record.expires_at !== "string" || !Number.isFinite(Date.parse(record.expires_at))) throw new Error(PUBLIC_ERROR);
      try { uuid(record.invitation_id); } catch { throw new Error(PUBLIC_ERROR); }
      // The RPC locks and snapshots authoritative contact email. Refuse sending
      // if a concurrent contact edit changed the preflight address/flow.
      const snapshot = await admin.from("parent_invitations").select("email_normalized").eq("id", record.invitation_id).eq("therapist_id", userId).single();
      if (snapshot.error || snapshot.data?.email_normalized !== email) throw new Error(PUBLIC_ERROR);
      const redirectTo = `https://app.fizira.com/parent.html?invite=${encodeURIComponent(token)}`;
      const delivery = existing
        ? await admin.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } })
        : await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (delivery.error) throw new Error(PUBLIC_ERROR);
      return parentJson(origin, 200, { ok: true, expires_at: record.expires_at });
    } catch (error) {
      return parentJson(origin, error instanceof ParentPublicError ? error.status : 503, { error: PUBLIC_ERROR });
    }
  };
}
