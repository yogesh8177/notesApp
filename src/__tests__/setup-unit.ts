/**
 * Runs before unit tests.
 * Stubs env vars so @/lib/env passes Zod validation at import time.
 * Unit tests mock the modules that use these (db, supabase, etc.) so
 * no real connections are made.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "placeholder-service-role-key";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder";
(process.env as Record<string, string>).NODE_ENV =
  process.env.NODE_ENV ?? "test";
