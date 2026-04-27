import { db } from "@/lib/db/client";
import {
  memberships,
  noteShares,
  notes,
  type NoteVisibility,
  type OrgRole,
  type SharePermission,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { log } from "@/lib/log";
import { audit } from "@/lib/log/audit";

/**
 * App-level permission helpers. These mirror the SQL helpers in
 * `drizzle/0002_rls_policies.sql` (`can_read_note`, `can_write_note`).
 *
 * Why duplicate? Two reasons:
 *   1. RLS denies as "no rows" — that's terrible UX. App-level checks let us
 *      return 403 with a real message.
 *   2. Defense in depth: if RLS is ever accidentally disabled (e.g. via
 *      service-role client misuse), app-level checks still hold.
 *
 * Rule for module agents: **always run app-level check first, then trust RLS
 * to back you up**. Never rely on app-level alone.
 */

const ROLE_RANK: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

export interface NotePermission {
  canRead: boolean;
  canWrite: boolean;
  canShare: boolean;
  canDelete: boolean;
  reason?: string;
}

/**
 * Compute the current user's effective permissions on a note.
 * Single round-trip: joins notes + memberships + note_shares.
 */
export async function getNotePermission(
  noteId: string,
  userId: string,
): Promise<NotePermission> {
  // Load the note + viewer's membership in its org + their share row.
  const rows = await db
    .select({
      note: {
        id: notes.id,
        orgId: notes.orgId,
        authorId: notes.authorId,
        visibility: notes.visibility,
        deletedAt: notes.deletedAt,
      },
      role: memberships.role,
      sharePerm: noteShares.permission,
    })
    .from(notes)
    .leftJoin(
      memberships,
      and(eq(memberships.orgId, notes.orgId), eq(memberships.userId, userId)),
    )
    .leftJoin(
      noteShares,
      and(eq(noteShares.noteId, notes.id), eq(noteShares.sharedWithUserId, userId)),
    )
    .where(eq(notes.id, noteId))
    .limit(1);

  const row = rows[0];
  if (!row || row.note.deletedAt) {
    return { canRead: false, canWrite: false, canShare: false, canDelete: false, reason: "not-found" };
  }

  const isAuthor = row.note.authorId === userId;
  const isOrgMember = row.role !== null;
  const isOrgAdmin = row.role !== null && ROLE_RANK[row.role] >= ROLE_RANK["admin"];
  const isOrgWriter = row.role !== null && ROLE_RANK[row.role] >= ROLE_RANK["member"];
  const shareRaw = row.sharePerm;
  const hasEditShare = (shareRaw as string | null) === "edit";

  const canRead = computeCanRead({
    visibility: row.note.visibility,
    isAuthor,
    isOrgMember,
    isOrgAdmin,
    hasShare: shareRaw !== null,
  });

  if (!canRead) {
    return { canRead: false, canWrite: false, canShare: false, canDelete: false, reason: "forbidden" };
  }

  const canWrite = isAuthor || isOrgAdmin || hasEditShare || (row.note.visibility === "org" && isOrgWriter && hasEditShare);
  const canShare = isAuthor || isOrgAdmin;
  const canDelete = isAuthor || isOrgAdmin;

  return { canRead, canWrite, canShare, canDelete };
}

interface ReadCtx {
  visibility: NoteVisibility;
  isAuthor: boolean;
  isOrgMember: boolean;
  isOrgAdmin: boolean;
  hasShare: boolean;
}

function computeCanRead(c: ReadCtx): boolean {
  if (c.isOrgAdmin) return true;
  switch (c.visibility) {
    case "private":
      return c.isAuthor;
    case "org":
      return c.isOrgMember;
    case "shared":
      return c.isAuthor || c.hasShare;
  }
}

/**
 * Quick membership check without the note details — used when the resource
 * isn't a note (e.g. file uploads to org-level storage).
 */
export async function isOrgMember(orgId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .limit(1);
  return !!row;
}

/**
 * Throwing variants. Module agents — use these in server actions and route
 * handlers so the caller doesn't forget to check the result.
 */
export async function assertCanReadNote(noteId: string, userId: string): Promise<void> {
  const p = await getNotePermission(noteId, userId);
  if (!p.canRead) {
    log.warn({ noteId, userId, reason: p.reason }, "note.permission_denied:read");
    await audit({
      action: "permission.denied",
      userId,
      resourceType: "note",
      resourceId: noteId,
      metadata: { check: "note:read", reason: p.reason ?? "forbidden" },
    });
    throw new PermissionError(p.reason ?? "forbidden", "note:read", noteId);
  }
}

export async function assertCanWriteNote(noteId: string, userId: string): Promise<void> {
  const p = await getNotePermission(noteId, userId);
  if (!p.canWrite) {
    log.warn({ noteId, userId, reason: p.reason }, "note.permission_denied:write");
    await audit({
      action: "permission.denied",
      userId,
      resourceType: "note",
      resourceId: noteId,
      metadata: { check: "note:write", reason: p.reason ?? "forbidden" },
    });
    throw new PermissionError(p.reason ?? "forbidden", "note:write", noteId);
  }
}

export async function assertCanShareNote(noteId: string, userId: string): Promise<void> {
  const p = await getNotePermission(noteId, userId);
  if (!p.canShare) {
    log.warn({ noteId, userId, reason: p.reason }, "note.permission_denied:share");
    await audit({
      action: "permission.denied",
      userId,
      resourceType: "note",
      resourceId: noteId,
      metadata: { check: "note:share", reason: p.reason ?? "forbidden" },
    });
    throw new PermissionError(p.reason ?? "forbidden", "note:share", noteId);
  }
}

export class PermissionError extends Error {
  readonly code = "PERMISSION_DENIED";
  constructor(
    public readonly reason: string,
    public readonly action: string,
    public readonly resourceId: string,
  ) {
    super(`Permission denied: ${action} on ${resourceId} (${reason})`);
    this.name = "PermissionError";
  }
}

