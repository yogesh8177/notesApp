/**
 * Internal DB helpers used by crud.ts, shares.ts and history.ts.
 * Nothing here is exported from the public index — callers use the
 * higher-level service functions.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  memberships,
  noteShares,
  notes,
  noteTags,
  noteVersions,
  tags,
  users,
  type NoteVisibility,
  type OrgRole,
} from "@/lib/db/schema";
import { getMembership } from "@/lib/auth/org";
import { NotesError } from "./errors";

export const ROLE_RANK: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface OrgMemberOption {
  id: string;
  email: string;
  displayName: string | null;
  role: OrgRole;
}

export interface NoteVersionSummary {
  id: string;
  version: number;
  title: string;
  visibility: NoteVisibility;
  changeSummary: string | null;
  createdAt: Date;
  changedBy: {
    id: string;
    email: string;
    displayName: string | null;
  };
}

export interface NoteShareRecord {
  id: string;
  permission: "view" | "edit";
  createdAt: Date;
  sharedBy: { id: string; email: string; displayName: string | null };
  sharedWith: { id: string; email: string; displayName: string | null };
}

// ---------------------------------------------------------------------------
// Permission / membership helpers
// ---------------------------------------------------------------------------

export async function requireMemberRole(orgId: string, userId: string, minRole: OrgRole) {
  const membership = await getMembership(orgId, userId);
  if (!membership) {
    throw new NotesError("FORBIDDEN", "You are not a member of this organisation.");
  }
  if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
    throw new NotesError("FORBIDDEN", `This action requires at least ${minRole} access.`);
  }
  return membership.role;
}

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

export function normalizeTags(values: string[]) {
  return Array.from(
    new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean)),
  ).slice(0, 20);
}

export function excerpt(value: string) {
  const s = value.replace(/\s+/g, " ").trim();
  return s.length <= 180 ? s : `${s.slice(0, 177)}...`;
}

/** Batch-load tag names for a list of note IDs. */
export async function loadTagsForNotes(noteIds: string[]) {
  if (noteIds.length === 0) return new Map<string, string[]>();
  const rows = await db
    .select({ noteId: noteTags.noteId, name: tags.name })
    .from(noteTags)
    .innerJoin(tags, eq(tags.id, noteTags.tagId))
    .where(inArray(noteTags.noteId, noteIds));

  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const current = grouped.get(row.noteId) ?? [];
    current.push(row.name);
    grouped.set(row.noteId, current.sort());
  }
  return grouped;
}

/** Batch-load share counts for a list of note IDs. */
export async function loadShareCounts(noteIds: string[]) {
  if (noteIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({
      noteId: noteShares.noteId,
      count: sql<number>`count(*)::int`,
    })
    .from(noteShares)
    .where(inArray(noteShares.noteId, noteIds))
    .groupBy(noteShares.noteId);

  return new Map(rows.map((r) => [r.noteId, r.count]));
}

/**
 * Delete all existing tag links for a note, then insert the given tag names,
 * creating org-scoped tag rows if they don't exist yet.
 */
export async function ensureTags(tx: DbTx, orgId: string, noteId: string, tagNames: string[]) {
  await tx.delete(noteTags).where(eq(noteTags.noteId, noteId));
  if (tagNames.length === 0) return;

  await tx
    .insert(tags)
    .values(tagNames.map((name) => ({ orgId, name })))
    .onConflictDoNothing();

  const tagRows = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.orgId, orgId), inArray(tags.name, tagNames)));

  if (tagRows.length === 0) return;

  await tx
    .insert(noteTags)
    .values(tagRows.map((row) => ({ noteId, tagId: row.id })))
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

export async function insertVersion(
  tx: DbTx,
  payload: {
    noteId: string;
    version: number;
    title: string;
    content: string;
    visibility: NoteVisibility;
    changedBy: string;
    changeSummary?: string | null;
  },
) {
  await tx.insert(noteVersions).values({
    noteId: payload.noteId,
    version: payload.version,
    title: payload.title,
    content: payload.content,
    visibility: payload.visibility,
    changedBy: payload.changedBy,
    changeSummary: payload.changeSummary ?? null,
  });
}

export async function loadHistory(noteId: string): Promise<NoteVersionSummary[]> {
  const rows = await db
    .select({
      id: noteVersions.id,
      version: noteVersions.version,
      title: noteVersions.title,
      visibility: noteVersions.visibility,
      changeSummary: noteVersions.changeSummary,
      createdAt: noteVersions.createdAt,
      changedById: users.id,
      changedByEmail: users.email,
      changedByDisplayName: users.displayName,
    })
    .from(noteVersions)
    .innerJoin(users, eq(users.id, noteVersions.changedBy))
    .where(eq(noteVersions.noteId, noteId))
    .orderBy(desc(noteVersions.version));

  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    title: row.title,
    visibility: row.visibility,
    changeSummary: row.changeSummary,
    createdAt: row.createdAt,
    changedBy: {
      id: row.changedById,
      email: row.changedByEmail,
      displayName: row.changedByDisplayName,
    },
  }));
}

// ---------------------------------------------------------------------------
// Share helpers
// ---------------------------------------------------------------------------

export async function loadShares(noteId: string): Promise<NoteShareRecord[]> {
  const rows = await db
    .select({
      id: noteShares.id,
      permission: noteShares.permission,
      createdAt: noteShares.createdAt,
      sharedWithUserId: noteShares.sharedWithUserId,
      sharedByUserId: noteShares.sharedBy,
    })
    .from(noteShares)
    .where(eq(noteShares.noteId, noteId))
    .orderBy(noteShares.createdAt);

  if (rows.length === 0) return [];

  const userIds = Array.from(
    new Set(rows.flatMap((r) => [r.sharedWithUserId, r.sharedByUserId])),
  );
  const userRows = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, userIds));
  const userMap = new Map(userRows.map((u) => [u.id, u]));

  return rows.map((row) => ({
    id: row.id,
    permission: row.permission,
    createdAt: row.createdAt,
    sharedBy: {
      id: row.sharedByUserId,
      email: userMap.get(row.sharedByUserId)?.email ?? "",
      displayName: userMap.get(row.sharedByUserId)?.displayName ?? null,
    },
    sharedWith: {
      id: row.sharedWithUserId,
      email: userMap.get(row.sharedWithUserId)?.email ?? "",
      displayName: userMap.get(row.sharedWithUserId)?.displayName ?? null,
    },
  }));
}

// ---------------------------------------------------------------------------
// Org member helpers
// ---------------------------------------------------------------------------

export async function listOrgMembers(orgId: string): Promise<OrgMemberOption[]> {
  return db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .orderBy(users.email);
}
