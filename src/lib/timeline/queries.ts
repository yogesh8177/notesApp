import { and, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLog, notes, users } from "@/lib/db/schema";

export interface TimelineEvent {
  id: number;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  actor: { id: string | null; email: string | null; displayName: string | null };
  noteId: string | null;
  noteTitle: string | null;
  noteDeleted: boolean;
}

export async function getNoteTimeline(
  orgId: string,
  noteId: string,
  limit = 100,
): Promise<TimelineEvent[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      resourceType: auditLog.resourceType,
      resourceId: auditLog.resourceId,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
      actorId: users.id,
      actorEmail: users.email,
      actorDisplayName: users.displayName,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(
      and(
        eq(auditLog.orgId, orgId),
        or(
          and(eq(auditLog.resourceType, "note"), eq(auditLog.resourceId, noteId)),
          sql`${auditLog.metadata}->>'noteId' = ${noteId}`,
        ),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  const noteIdSet = new Set([noteId]);
  const noteTitleMap = new Map<string, { title: string; deletedAt: Date | null }>();
  const noteRows = await db
    .select({ id: notes.id, title: notes.title, deletedAt: notes.deletedAt })
    .from(notes)
    .where(inArray(notes.id, Array.from(noteIdSet)));
  for (const n of noteRows) {
    noteTitleMap.set(n.id, { title: n.title, deletedAt: n.deletedAt });
  }

  return rows.map((row) => {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const resolvedNoteId =
      row.resourceType === "note" && row.resourceId
        ? row.resourceId
        : typeof meta.noteId === "string"
          ? meta.noteId
          : null;
    const noteInfo = resolvedNoteId ? noteTitleMap.get(resolvedNoteId) : undefined;

    return {
      id: row.id,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      metadata: meta,
      createdAt: row.createdAt,
      actor: {
        id: row.actorId ?? null,
        email: row.actorEmail ?? null,
        displayName: row.actorDisplayName ?? null,
      },
      noteId: resolvedNoteId,
      noteTitle: noteInfo?.title ?? null,
      noteDeleted: noteInfo ? noteInfo.deletedAt !== null : false,
    };
  });
}

export interface ToolCallCount {
  toolName: string;
  callCount: number;
}

/**
 * Return per-tool call counts for mcp.tool.call events associated with a note.
 * Tool name is stored in resourceId; the note is identified via metadata->>'noteId'.
 */
export async function getNoteToolCallCounts(
  orgId: string,
  noteId: string,
): Promise<ToolCallCount[]> {
  const rows = await db
    .select({
      toolName: auditLog.resourceId,
      callCount: count(auditLog.id),
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.orgId, orgId),
        eq(auditLog.action, "mcp.tool.call"),
        sql`${auditLog.metadata}->>'noteId' = ${noteId}`,
      ),
    )
    .groupBy(auditLog.resourceId)
    .orderBy(desc(count(auditLog.id)));

  return rows
    .filter((r): r is { toolName: string; callCount: number } => r.toolName !== null)
    .map((r) => ({ toolName: r.toolName, callCount: r.callCount }));
}

export async function getOrgTimeline(orgId: string, limit = 50): Promise<TimelineEvent[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      resourceType: auditLog.resourceType,
      resourceId: auditLog.resourceId,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
      actorId: users.id,
      actorEmail: users.email,
      actorDisplayName: users.displayName,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(eq(auditLog.orgId, orgId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  // Collect note IDs to batch-load titles
  const noteIdSet = new Set<string>();
  for (const row of rows) {
    if (row.resourceType === "note" && row.resourceId) {
      noteIdSet.add(row.resourceId);
    }
    // AI summary events embed noteId in metadata
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    if (row.action.startsWith("ai.summary.") && typeof meta.noteId === "string") {
      noteIdSet.add(meta.noteId);
    }
  }

  const noteTitleMap = new Map<string, { title: string; deletedAt: Date | null }>();
  if (noteIdSet.size > 0) {
    const noteRows = await db
      .select({ id: notes.id, title: notes.title, deletedAt: notes.deletedAt })
      .from(notes)
      .where(inArray(notes.id, Array.from(noteIdSet)));
    for (const n of noteRows) {
      noteTitleMap.set(n.id, { title: n.title, deletedAt: n.deletedAt });
    }
  }

  return rows.map((row) => {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    let noteId: string | null =
      row.resourceType === "note" && row.resourceId ? row.resourceId : null;
    if (!noteId && row.action.startsWith("ai.summary.") && typeof meta.noteId === "string") {
      noteId = meta.noteId;
    }
    const noteInfo = noteId ? noteTitleMap.get(noteId) : undefined;

    return {
      id: row.id,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      metadata: meta,
      createdAt: row.createdAt,
      actor: {
        id: row.actorId ?? null,
        email: row.actorEmail ?? null,
        displayName: row.actorDisplayName ?? null,
      },
      noteId,
      noteTitle: noteInfo?.title ?? null,
      noteDeleted: noteInfo ? noteInfo.deletedAt !== null : false,
    };
  });
}
