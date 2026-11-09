// NEXT_PUBLIC_* values are inlined at build time, so each is referenced literally.
export const env = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
  otherAppUrl: process.env.NEXT_PUBLIC_OTHER_APP_URL ?? "http://localhost:3001",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
};

export function supabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseKey);
}
