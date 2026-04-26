/**
 * Seed entrypoint. Owned by `seed-10k` module agent for content; baseline
 * ships the skeleton — connect, truncate, batch-insert, log.
 *
 * Usage:
 *   pnpm seed              -> small dev seed
 *   pnpm seed:large        -> SEED_NOTE_COUNT=10000
 *
 * Hard requirements (do NOT change without surfacing to orchestrator):
 *   - Use the SERVICE-ROLE Supabase client OR direct DB connection. Never
 *     run seed through the anon client; RLS will reject most inserts.
 *   - Wrap everything in a transaction so a failure leaves the DB clean.
 *   - Insert in batches of 500–1000 to keep Postgres happy.
 *   - Print summary counts at the end.
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { setFakerSeed } from "./factories";

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL or DIRECT_URL must be set");

  const noteCount = Number(process.env.SEED_NOTE_COUNT ?? 100);
  const userCount = Number(process.env.SEED_USER_COUNT ?? 5);
  const orgCount = Number(process.env.SEED_ORG_COUNT ?? 2);

  console.log(
    `▶ seeding: ${orgCount} orgs · ${userCount} users · ${noteCount} notes`,
  );
  setFakerSeed(Number(process.env.SEED_RNG ?? 42));

  const sql = postgres(url, { max: 1, prepare: false });
  const db = drizzle(sql, { schema });

  try {
    // The seed-10k agent fills in:
    //   1. Create users via Supabase admin API (so auth.users + trigger -> public.users)
    //   2. Create orgs + memberships
    //   3. Create tags per org
    //   4. Create notes (batched) + their versions + tag associations
    //   5. Create note_shares for ~visibility='shared' notes
    //   6. Upload sample files via service-role storage client
    //
    // For each step, log progress every 1000 rows.

    console.log("seed skeleton — content TODO by seed-10k agent");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
