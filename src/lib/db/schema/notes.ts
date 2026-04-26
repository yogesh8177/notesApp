import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  primaryKey,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { noteVisibility, sharePermission } from "./enums";
import { orgs } from "./orgs";
import { users } from "./users";

/**
 * tsvector custom type — Drizzle has no first-class type, so we declare it.
 * The actual column is GENERATED ALWAYS AS via the SQL migration so we never
 * write it from app code.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    visibility: noteVisibility("visibility").notNull().default("org"),
    currentVersion: integer("current_version").notNull().default(1),
    /** GENERATED column — read-only from app code. */
    searchVector: tsvector("search_vector"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    orgIdx: index("notes_org_idx").on(t.orgId),
    orgUpdatedIdx: index("notes_org_updated_idx").on(t.orgId, t.updatedAt),
    authorIdx: index("notes_author_idx").on(t.authorId),
    // search_vector GIN + pg_trgm indexes are created in the SQL migration
    // (drizzle-kit can't express the operator class on tsvector / gin_trgm_ops)
  }),
);

export const noteVersions = pgTable(
  "note_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    visibility: noteVisibility("visibility").notNull(),
    changedBy: uuid("changed_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    changeSummary: text("change_summary"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    noteVersionUnique: uniqueIndex("note_versions_note_version_unique").on(
      t.noteId,
      t.version,
    ),
    noteCreatedIdx: index("note_versions_note_created_idx").on(t.noteId, t.createdAt),
  }),
);

export const noteShares = pgTable(
  "note_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    sharedWithUserId: uuid("shared_with_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permission: sharePermission("permission").notNull().default("view"),
    sharedBy: uuid("shared_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    noteUserUnique: uniqueIndex("note_shares_note_user_unique").on(
      t.noteId,
      t.sharedWithUserId,
    ),
    userIdx: index("note_shares_user_idx").on(t.sharedWithUserId),
  }),
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    orgNameUnique: uniqueIndex("tags_org_name_unique").on(t.orgId, t.name),
  }),
);

export const noteTags = pgTable(
  "note_tags",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.noteId, t.tagId] }),
    tagIdx: index("note_tags_tag_idx").on(t.tagId),
  }),
);
