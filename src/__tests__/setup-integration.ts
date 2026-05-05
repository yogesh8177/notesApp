/**
 * Runs before integration tests.
 * Sets stub env vars so @/lib/env passes Zod validation at import time.
 * Real vars (DATABASE_URL, NEO4J_URI) must already be set in the environment.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "placeholder-service-role-key";
// NODE_ENV is read-only in TypeScript's ProcessEnv; cast to bypass.
(process.env as Record<string, string>).NODE_ENV =
  process.env.NODE_ENV ?? "test";
