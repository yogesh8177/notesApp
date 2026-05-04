import { db } from "@/lib/db/client";
import { graphSyncQueue } from "@/lib/db/schema";
import type { GraphNodeType } from "./types";

// Accepts either the db instance or a drizzle transaction so callers can
// enqueue inside the same transaction that mutates Postgres — guaranteeing
// no write is ever committed without a corresponding sync job.
type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function enqueueSync(
  nodeType: GraphNodeType,
  nodeId: string,
  orgId: string,
  tx?: DbOrTx
): Promise<void> {
  const writer = tx ?? db;
  await writer.insert(graphSyncQueue).values({ operation: "sync", nodeType, nodeId, orgId });
}

export async function enqueueDelete(
  nodeType: GraphNodeType,
  nodeId: string,
  orgId: string,
  tx?: DbOrTx
): Promise<void> {
  const writer = tx ?? db;
  await writer.insert(graphSyncQueue).values({ operation: "delete", nodeType, nodeId, orgId });
}
