import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orgs } from "./orgs";
import { notes } from "./notes";
import { users } from "./users";

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

export const agentTokens = pgTable(
  "agent_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** First 8 chars of the cleartext token suffix — for UI display only. */
    tokenPrefix: text("token_prefix").notNull(),
    /** sha256 hex of the full cleartext token. The cleartext is never stored. */
    tokenHash: text("token_hash").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    hashUnique: uniqueIndex("agent_tokens_hash_unique").on(t.tokenHash),
    orgActiveIdx: index("agent_tokens_org_active_idx").on(t.orgId),
  }),
);
