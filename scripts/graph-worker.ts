#!/usr/bin/env tsx
/**
 * Graph sync worker — drains graph_sync_queue into Neo4j.
 * Run as a dedicated Railway worker service:
 *   Start command: npx tsx scripts/graph-worker.ts
 *
 * Env vars required:
 *   DATABASE_URL          — Postgres (pooler URL is fine for queries)
 *   NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD
 * Optional:
 *   DATABASE_DIRECT_URL   — direct Postgres connection for pg_notify fast-wake
 *                           (bypasses Supabase transaction-mode pooler)
 */

import "@/lib/env"; // validate env on startup
import { runWorker } from "@/lib/graph/worker";

const controller = new AbortController();

process.on("SIGTERM", () => {
  console.log("[graph-worker] SIGTERM received — shutting down");
  controller.abort();
});
process.on("SIGINT", () => {
  console.log("[graph-worker] SIGINT received — shutting down");
  controller.abort();
});

runWorker(controller.signal).catch((err) => {
  console.error("[graph-worker] fatal error", err);
  process.exit(1);
});
