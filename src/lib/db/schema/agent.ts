import { pgTable, uuid, text, timestamp, uniqueIndex, index, integer, jsonb } from "drizzle-orm/pg-core";
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

export const sessionEpochSummaries = pgTable(
  "session_epoch_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    epochStart: integer("epoch_start").notNull(),
    epochEnd: integer("epoch_end").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    noteIdx: index("session_epoch_summaries_note_idx").on(t.noteId),
    noteEpochUnique: uniqueIndex("session_epoch_summaries_note_epoch_unique").on(
      t.noteId,
      t.epochEnd,
    ),
  }),
);

export const conversationTurns = pgTable(
  "conversation_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    sessionNoteId: uuid("session_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    turnIndex: integer("turn_index").notNull(),
    role: text("role").notNull(), // "user" | "assistant"
    content: text("content").notNull(),
    noteRefs: jsonb("note_refs")
      .$type<{ noteId: string; version?: number; title?: string }[]>()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    sessionIdx: index("conversation_turns_session_idx").on(t.sessionNoteId),
    sessionTurnUnique: uniqueIndex("conversation_turns_session_turn_unique").on(
      t.sessionNoteId,
      t.turnIndex,
    ),
  }),
);

export const conversationSummaries = pgTable(
  "conversation_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    sessionNoteId: uuid("session_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    turnStart: integer("turn_start").notNull(),
    turnEnd: integer("turn_end").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    sessionIdx: index("conversation_summaries_session_idx").on(t.sessionNoteId),
    sessionWindowUnique: uniqueIndex("conversation_summaries_session_window_unique").on(
      t.sessionNoteId,
      t.turnEnd,
    ),
  }),
);
