/**
 * Runs before integration tests.
 * Loads .env so real DB/service vars are available; stubs non-critical vars so
 * @/lib/env passes Zod validation even when running outside the full app env.
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "placeholder-service-role-key";
// NODE_ENV is read-only in TypeScript's ProcessEnv; cast to bypass.
(process.env as Record<string, string>).NODE_ENV =
  process.env.NODE_ENV ?? "test";
