import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  bigserial,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Append-only operational log. Every meaningful event lands here:
 *   - auth.signin, auth.signout, auth.signup
 *   - note.create, note.update, note.delete, note.share, note.unshare
 *   - file.upload, file.download, file.delete
 *   - ai.summary.request, ai.summary.complete, ai.summary.fail, ai.summary.fallback
 *   - permission.denied
 *   - org.create, org.invite, org.invite.accept, org.role.change
 *
 * Module agents: USE `lib/log/audit.ts` to write rows — never write directly.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Nullable for unauthenticated events (e.g. failed signin) */
    orgId: uuid("org_id"),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    orgCreatedIdx: index("audit_log_org_created_idx").on(t.orgId, t.createdAt),
    actionIdx: index("audit_log_action_idx").on(t.action),
    userCreatedIdx: index("audit_log_user_created_idx").on(t.userId, t.createdAt),
  }),
);
