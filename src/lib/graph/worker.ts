import { sql, lt, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { graphSyncQueue } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { syncNode, deleteNode } from "./sync";
import type { GraphNodeType } from "./types";

const BATCH_SIZE = 20;
const POLL_INTERVAL_MS = 3000;
const MAX_ATTEMPTS = 5;

function backoffMs(attempts: number): number {
  // 2s → 4s → 8s → 16s → 32s, capped at 60s
  return Math.min(1000 * 2 ** (attempts + 1), 60_000);
}

async function processBatch(): Promise<number> {
  // Claim a batch: SELECT FOR UPDATE SKIP LOCKED so multiple worker replicas
  // don't double-process. Raw sql needed — drizzle has no SKIP LOCKED builder.
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      SELECT id, operation, node_type, node_id, org_id, attempts
      FROM graph_sync_queue
      WHERE scheduled_at <= now() AND attempts < max_attempts
      ORDER BY created_at
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `);
    return rows as unknown as {
      id: number;
      operation: string;
      node_type: string;
      node_id: string;
      org_id: string;
      attempts: number;
    }[];
  });

  if (!claimed.length) return 0;

  await Promise.allSettled(
    claimed.map(async (row) => {
      try {
        if (row.operation === "delete") {
          await deleteNode(row.node_type as GraphNodeType, row.node_id);
        } else {
          await syncNode(row.node_type as GraphNodeType, row.node_id, row.org_id);
        }
        await db.delete(graphSyncQueue).where(sql`id = ${row.id}`);
        log.debug({ id: row.id, op: row.operation, type: row.node_type }, "graph.worker.ok");
      } catch (err) {
        const nextAttempts = row.attempts + 1;
        const delay = backoffMs(nextAttempts);
        await db
          .update(graphSyncQueue)
          .set({
            attempts: nextAttempts,
            lastError: err instanceof Error ? err.message : String(err),
            scheduledAt: sql`now() + ${delay} * interval '1 millisecond'`,
          })
          .where(sql`id = ${row.id}`);
        log.warn(
          { id: row.id, type: row.node_type, attempts: nextAttempts, err },
          "graph.worker.retry"
        );
      }
    })
  );

  return claimed.length;
}

// Purge rows that have exhausted all retries — prevents unbounded table growth.
async function purgeExhausted(): Promise<void> {
  await db
    .delete(graphSyncQueue)
    .where(and(sql`attempts >= max_attempts`, lt(graphSyncQueue.scheduledAt, sql`now()`)));
}

export async function runWorker(signal: AbortSignal): Promise<void> {
  log.info("graph.worker.start");

  // Optional: listen for pg_notify to wake immediately on new inserts.
  // Requires DATABASE_DIRECT_URL — a direct Postgres connection that bypasses
  // the Supabase transaction-mode pooler (which doesn't support LISTEN).
  let notify: { unlisten: () => Promise<void> } | null = null;
  let wakeResolve: (() => void) | null = null;

  if (process.env.DATABASE_DIRECT_URL) {
    try {
      const postgres = (await import("postgres")).default;
      const listenClient = postgres(process.env.DATABASE_DIRECT_URL, { max: 1 });
      await listenClient.listen("graph_sync", () => {
        wakeResolve?.();
        wakeResolve = null;
      });
      notify = {
        unlisten: async () => {
          await listenClient.end();
        },
      };
      log.info("graph.worker.listen.ok");
    } catch (err) {
      log.warn({ err }, "graph.worker.listen.skip — falling back to polling");
    }
  }

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      const t = setTimeout(resolve, ms);
      wakeResolve = resolve;
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    });

  let iteration = 0;
  while (!signal.aborted) {
    try {
      const processed = await processBatch();
      // Purge exhausted rows every 100 iterations (~5 min at 3s poll)
      if (++iteration % 100 === 0) await purgeExhausted();
      // If we processed a full batch there may be more — skip the sleep.
      if (processed < BATCH_SIZE) await sleep(POLL_INTERVAL_MS);
    } catch (err) {
      log.error({ err }, "graph.worker.loop.error");
      await sleep(POLL_INTERVAL_MS);
    }
  }

  await notify?.unlisten();
  log.info("graph.worker.stop");
}
