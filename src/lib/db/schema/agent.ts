import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orgs } from "./orgs";
import { notes } from "./notes";

export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    repo: text("repo").notNull(),
    branch: text("branch").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    identityUnique: uniqueIndex("agent_sessions_identity_unique").on(
      t.orgId,
      t.agentId,
      t.repo,
      t.branch,
    ),
    noteIdx: index("agent_sessions_note_idx").on(t.noteId),
  }),
);
