import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client (public anon key). Safe in Client Components —
 * used only to kick off Google sign-in.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
