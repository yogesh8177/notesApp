/**
 * Test-only migration runner.
 *
 * Same logic as migrate.ts but skips Supabase-specific migration files that
 * reference auth.uid() / storage — those require the Supabase Postgres runtime.
 * Before running the base schema migration, this script pre-creates the `auth`
 * schema and stub `auth.users` table so the FK constraints in 0000_ succeed.
 */
import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

// These files call auth.uid() or reference Supabase storage — skip on plain Postgres.
const SUPABASE_ONLY = new Set([
  "0002_rls_policies.sql",
  "0003_storage_policies.sql",
]);

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL or DIRECT_URL must be set");

  const sql = postgres(url, { max: 1, prepare: false });

  try {
    // Pre-create auth schema only — 0000_ creates auth.users itself.
    // Do NOT create auth.users here; that would conflict with the migration's
    // CREATE TABLE "auth"."users" (which has no IF NOT EXISTS).
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS auth;`);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set(
      (await sql<{ filename: string }[]>`SELECT filename FROM _migrations`).map(
        (r) => r.filename,
      ),
    );

    const dir = join(process.cwd(), "drizzle");
    const files = (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (SUPABASE_ONLY.has(file)) {
        console.log(`  skip  ${file} (Supabase-only)`);
        continue;
      }
      if (applied.has(file)) {
        console.log(`  skip  ${file} (already applied)`);
        continue;
      }
      const content = await readFile(join(dir, file), "utf8");
      await sql.unsafe(content);
      await sql`INSERT INTO _migrations (filename) VALUES (${file})`;
      console.log(`  apply ${file}`);
      ran++;
    }

    console.log(`\nDone — ${ran} migration(s) applied.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
