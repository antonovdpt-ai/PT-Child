import { createClient } from "jsr:@supabase/supabase-js@2";
import { parentHandler } from "../_shared/parent-portal.ts";
Deno.serve(parentHandler("resend", ["invitation_id"], {
  createClient, env: (name) => Deno.env.get(name),
}));
