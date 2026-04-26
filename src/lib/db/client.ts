import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { env } from "@/lib/env";

/**
 * Server-side Drizzle client. Bypasses RLS — use only in trusted server code
 * after permission checks have run. For RLS-respecting queries from a request
 * context, use the Supabase client (`@/lib/supabase/server`).
 */
const globalForDb = globalThis as unknown as {
  pg: ReturnType<typeof postgres> | undefined;
};

const pg =
  globalForDb.pg ??
  postgres(env.DATABASE_URL, {
    max: env.NODE_ENV === "production" ? 10 : 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // required for Supabase pooler (transaction mode)
  });

if (env.NODE_ENV !== "production") globalForDb.pg = pg;

export const db = drizzle(pg, { schema });
export type Db = typeof db;
export { schema };
