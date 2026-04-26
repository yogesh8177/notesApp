import { pgTable, uuid, text, timestamp, pgSchema } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Mirror of `auth.users` — Supabase manages auth.users, we don't write to it.
 * This is a Drizzle-only handle so we can reference user IDs in foreign keys.
 *
 * IMPORTANT: never insert/update/delete via this handle. Source of truth is
 * Supabase Auth. The `public.users` table below stores app-level profile data.
 */
const authSchema = pgSchema("auth");

export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
  email: text("email"),
});

/**
 * App-level user profile. Row is created via DB trigger when auth.users gets a
 * row (see RLS migration). Don't mutate auth fields here.
 */
export const users = pgTable("users", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
