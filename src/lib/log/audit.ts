import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import { log } from "@/lib/log";

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
  | (string & {});

export interface AuditEvent {
  action: AuditAction;
  orgId?: string | null;
  userId?: string | null;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
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

  // 2. persist row — best effort. Never let an audit failure block the
  // user's request, but DO surface it in logs for ops.
  try {
    await db.insert(auditLog).values({
      action: event.action,
      orgId: event.orgId ?? null,
      userId: event.userId ?? null,
      resourceType: event.resourceType ?? null,
      resourceId: event.resourceId ?? null,
      metadata: event.metadata ?? {},
      ip: event.ip ?? null,
      userAgent: event.userAgent ?? null,
    });
  } catch (err) {
    log.error({ err, action: event.action }, "audit.persist.fail");
  }
}
