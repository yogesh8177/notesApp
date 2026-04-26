import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client. Use only in client components.
 * Lazy: avoids the env access cost when SSR-rendered first.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
