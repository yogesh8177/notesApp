import { createClient as createSb } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role Supabase client. **BYPASSES RLS.**
 *
 * Use only in:
 *   - migrations / seed scripts
 *   - the audit log writer (already done via Drizzle)
 *   - background AI workers that have already verified permissions
 *
 * Never expose to the browser. Never call from a server component without
 * an explicit permission check first.
 */
let cached: ReturnType<typeof createSb> | null = null;

export function createServiceClient() {
  if (cached) return cached;
  cached = createSb(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
