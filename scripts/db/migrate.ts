/**
 * Apply SQL migration files in `drizzle/` in lexicographic order.
 * Tracks applied files in a `_migrations` table so repeated runs are safe.
 *
 * Run via `npm run db:migrate`.
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
    // Ensure tracking table exists
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
      if (applied.has(file)) {
        console.log(`⏭  ${file} (already applied)`);
        continue;
      }
      console.log(`▶ ${file}`);
      const body = await readFile(join(dir, file), "utf8");
      await sql.unsafe(body);
      await sql`INSERT INTO _migrations (filename) VALUES (${file})`;
      console.log(`✓ ${file}`);
      ran++;
    }

    if (ran === 0) console.log("Nothing to migrate.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
