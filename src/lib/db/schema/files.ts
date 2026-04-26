import { pgTable, uuid, text, timestamp, bigint, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orgs } from "./orgs";
import { users } from "./users";
import { notes } from "./notes";

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    /** Optional — files can be org-level or attached to a specific note */
    noteId: uuid("note_id").references(() => notes.id, { onDelete: "set null" }),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Storage bucket path, e.g. `${orgId}/${fileId}/${fileName}` */
    storagePath: text("storage_path").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    orgIdx: index("files_org_idx").on(t.orgId),
    noteIdx: index("files_note_idx").on(t.noteId),
  }),
);
