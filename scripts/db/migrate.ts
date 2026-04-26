/**
 * Apply Drizzle-generated migrations + the hand-written SQL files in `drizzle/`.
 *
 * Order:
 *   1. drizzle-kit generated migrations (created via `pnpm db:generate`)
 *   2. 0001_extensions_and_search.sql
 *   3. 0002_rls_policies.sql
 *   4. 0003_storage_policies.sql
 *
 * Run via `pnpm db:migrate`. Idempotent — every statement uses
 * IF NOT EXISTS / OR REPLACE / DROP TRIGGER IF EXISTS.
 */
import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL or DIRECT_URL must be set");
  }

  const sql = postgres(url, { max: 1, prepare: false });

  try {
    const dir = join(process.cwd(), "drizzle");
    const files = (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      console.log(`▶ ${file}`);
      const body = await readFile(join(dir, file), "utf8");
      await sql.unsafe(body);
      console.log(`✓ ${file}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
