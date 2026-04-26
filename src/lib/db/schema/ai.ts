import { pgTable, uuid, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { aiProvider, aiSummaryStatus } from "./enums";
import { notes } from "./notes";
import { users } from "./users";

/**
 * AI summary record. Structured output is stored as jsonb under `structured`.
 * Users selectively accept fields — accepted shape stored in `acceptedFields`.
 *
 * Contract for ai-summary module agent: structured output schema is owned by
 * `lib/ai/schema.ts` (zod). Update both together.
 */
export const aiSummaries = pgTable(
  "ai_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    /** snapshot of note version this was generated from */
    noteVersion: integer("note_version").notNull(),
    provider: aiProvider("provider").notNull(),
    model: text("model").notNull(),
    status: aiSummaryStatus("status").notNull().default("pending"),
    /** Raw response (debug). Don't render directly in UI. */
    rawOutput: jsonb("raw_output"),
    /** Structured + validated against zod schema */
    structured: jsonb("structured"),
    /** Subset of structured fields the user explicitly accepted */
    acceptedFields: jsonb("accepted_fields"),
    errorMessage: text("error_message"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    noteIdx: index("ai_summaries_note_idx").on(t.noteId),
    statusIdx: index("ai_summaries_status_idx").on(t.status),
  }),
);
