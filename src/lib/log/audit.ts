import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLog, notes } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { enqueueSync } from "@/lib/graph/queue";

/**
 * Audit log writer. Persists to `audit_log` AND emits a structured log line.
 *
 * USE this — never INSERT into audit_log directly. Centralised here so every
 * row goes through one path with one shape.
 *
 * Action naming convention: `<domain>.<verb>[.<qualifier>]`
 *   auth.signin, auth.signout, auth.signup
 *   note.create, note.update, note.delete, note.share, note.unshare
 *   file.upload, file.download, file.delete
 *   ai.summary.request, ai.summary.complete, ai.summary.fail, ai.summary.fallback
 *   permission.denied
 *   org.create, org.invite, org.invite.accept, org.role.change
 */
export type AuditAction =
  | `auth.${"signin" | "signout" | "signup" | "signin.fail"}`
  | `note.${"create" | "update" | "delete" | "share" | "unshare"}`
  | `file.${"upload" | "download" | "delete"}`
  | `ai.summary.${"request" | "complete" | "fail" | "fallback" | "accept"}`
  | "permission.denied"
  | `org.${"create" | "invite" | "invite.accept" | "role.change" | "switch"}`
  | `agent.session.${"bootstrap" | "checkpoint" | "auth.fail"}`
  | `agent.search${"" | ".auth.fail"}`
  | `agent.token.${"create" | "revoke"}`
  | `agent.event.${"subagent.start" | "subagent.stop" | "subagent.tool.call"}`
  | `mcp.${"tool.call" | "tool.error" | "resource.read" | "resource.error" | "auth.fail"}`
  | (string & {});

export interface AuditEvent {
  action: AuditAction;
  orgId?: string | null;
  userId?: string | null;
  resourceType?: string;
  resourceId?: string;
  /**
   * Optional repo identifier ("owner/repo") used to scope this event to a
   * project for timeline / recall filtering. When omitted but resourceType
   * is "note", we auto-resolve from notes.project_key.
   */
  projectKey?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Resolve project_key for a note-resource event when the caller didn't pass
 * one. Best-effort: a failed lookup leaves project_key NULL on the audit row,
 * which is fine — it just means the event won't appear in project-scoped
 * timeline filters.
 */
async function resolveProjectKey(event: AuditEvent): Promise<string | null> {
  if (event.projectKey !== undefined) return event.projectKey;
  if (event.resourceType !== "note" || !event.resourceId) return null;
  try {
    const [row] = await db
      .select({ projectKey: notes.projectKey })
      .from(notes)
      .where(eq(notes.id, event.resourceId))
      .limit(1);
    return row?.projectKey ?? null;
  } catch {
    return null;
  }
}

export async function audit(event: AuditEvent): Promise<void> {
  // 1. structured log line — always.
  log.info(
    {
      audit: true,
      action: event.action,
      orgId: event.orgId ?? undefined,
      userId: event.userId ?? undefined,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      metadata: event.metadata,
    },
    event.action,
  );

  const projectKey = await resolveProjectKey(event);

  // 2. persist row — best effort. Never let an audit failure block the
  // user's request, but DO surface it in logs for ops.
  try {
    const [row] = await db.insert(auditLog).values({
      action: event.action,
      orgId: event.orgId ?? null,
      userId: event.userId ?? null,
      resourceType: event.resourceType ?? null,
      resourceId: event.resourceId ?? null,
      projectKey,
      metadata: event.metadata ?? {},
      ip: event.ip ?? null,
      userAgent: event.userAgent ?? null,
    }).returning({ id: auditLog.id });

    if (row && event.orgId) {
      enqueueSync("AuditEvent", String(row.id), event.orgId).catch((err) =>
        log.error({ err, auditId: row.id }, "graph.enqueue.fail")
      );
    }
  } catch (err) {
    log.error({ err, action: event.action }, "audit.persist.fail");
  }
}
