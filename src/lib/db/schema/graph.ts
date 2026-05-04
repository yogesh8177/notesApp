import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const graphSyncQueue = pgTable("graph_sync_queue", {
  id: serial("id").primaryKey(),
  operation: text("operation").notNull().default("sync"), // "sync" | "delete"
  nodeType: text("node_type").notNull(),
  nodeId: text("node_id").notNull(),
  orgId: text("org_id").notNull(),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  lastError: text("last_error"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
