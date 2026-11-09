import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { env, supabaseConfigured } from "./env";

let client: SupabaseClient | null = null;

/** Browser Supabase client. Used for auth sessions only; data goes through the API. */
export function supabase(): SupabaseClient {
  if (!supabaseConfigured()) {
    throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  client ??= createBrowserClient(env.supabaseUrl, env.supabaseKey);
  return client;
}
