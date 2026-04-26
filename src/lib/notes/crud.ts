/**
 * Note CRUD: list, detail, create, update, soft-delete.
 * Each mutation writes a note_versions snapshot in the same transaction
 * and emits an audit event.
 */
import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  noteShares,
  notes,
  noteTags,
  tags,
  users,
} from "@/lib/db/schema";
import { assertCanReadNote, assertCanWriteNote, getNotePermission } from "@/lib/auth/permissions";
import { audit } from "@/lib/log/audit";
import { NotesError } from "./errors";
import type { NoteCreateInput, NotesListQuery, NoteUpdateInput } from "./schemas";
import {
  ROLE_RANK,
  type OrgMemberOption,
  type NoteShareRecord,
  type NoteVersionSummary,
  ensureTags,
  excerpt,
  insertVersion,
  listOrgMembers,
  loadHistory,
  loadShareCounts,
  loadShares,
  loadTagsForNotes,
  normalizeTags,
  requireMemberRole,
} from "./queries";

export type { OrgMemberOption, NoteShareRecord, NoteVersionSummary };

export interface NoteListItem {
  id: string;
  orgId: string;
  title: string;
  excerpt: string;
  visibility: "private" | "org" | "shared";
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; email: string; displayName: string | null };
  tags: string[];
  shareCount: number;
  isAuthor: boolean;
}

export interface NoteDetail {
  id: string;
  orgId: string;
  authorId: string;
  title: string;
  content: string;
  visibility: "private" | "org" | "shared";
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; email: string; displayName: string | null };
  tags: string[];
  shares: NoteShareRecord[];
  history: NoteVersionSummary[];
  permissions: Awaited<ReturnType<typeof getNotePermission>>;
}

// ---------------------------------------------------------------------------

export async function listNotesForUser(
  input: NotesListQuery,
  userId: string,
): Promise<{ notes: NoteListItem[]; members: OrgMemberOption[]; availableTags: string[] }> {
  const { orgId } = input;
  const membership = await requireMemberRole(orgId, userId, "viewer").catch(() => null);
  if (!membership) {
    throw new NotesError("FORBIDDEN", "You are not a member of this organisation.");
  }

  const isAdmin = ROLE_RANK[membership] >= ROLE_RANK.admin;
  const term = input.q?.trim();
  const normalizedTag = input.tag?.trim().toLowerCase();

  const accessCondition = isAdmin
    ? undefined
    : or(
        and(eq(notes.visibility, "private"), eq(notes.authorId, userId)),
        eq(notes.visibility, "org"),
        and(
          eq(notes.visibility, "shared"),
          or(eq(notes.authorId, userId), eq(noteShares.sharedWithUserId, userId)),
        ),
      );

  const filters = [
    eq(notes.orgId, orgId),
    isNull(notes.deletedAt),
    accessCondition,
    input.visibility ? eq(notes.visibility, input.visibility) : undefined,
    input.authorId ? eq(notes.authorId, input.authorId) : undefined,
    term ? or(ilike(notes.title, `%${term}%`), ilike(notes.content, `%${term}%`)) : undefined,
    normalizedTag ? eq(tags.name, normalizedTag) : undefined,
  ].filter(Boolean);

  const rows = await db
    .selectDistinct({
      id: notes.id,
      orgId: notes.orgId,
      title: notes.title,
      content: notes.content,
      visibility: notes.visibility,
      currentVersion: notes.currentVersion,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
      authorId: users.id,
      authorEmail: users.email,
      authorDisplayName: users.displayName,
    })
    .from(notes)
    .innerJoin(users, eq(users.id, notes.authorId))
    .leftJoin(noteShares, and(eq(noteShares.noteId, notes.id), eq(noteShares.sharedWithUserId, userId)))
    .leftJoin(noteTags, eq(noteTags.noteId, notes.id))
    .leftJoin(tags, eq(tags.id, noteTags.tagId))
    .where(and(...filters))
    .orderBy(desc(notes.updatedAt));

  const noteIds = rows.map((r) => r.id);
  const [tagMap, shareCountMap, members, tagRows] = await Promise.all([
    loadTagsForNotes(noteIds),
    loadShareCounts(noteIds),
    listOrgMembers(orgId),
    db.select({ name: tags.name }).from(tags).where(eq(tags.orgId, orgId)).orderBy(tags.name),
  ]);

  return {
    notes: rows.map((row) => ({
      id: row.id,
      orgId: row.orgId,
      title: row.title,
      excerpt: excerpt(row.content),
      visibility: row.visibility,
      currentVersion: row.currentVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      author: { id: row.authorId, email: row.authorEmail, displayName: row.authorDisplayName },
      tags: tagMap.get(row.id) ?? [],
      shareCount: shareCountMap.get(row.id) ?? 0,
      isAuthor: row.authorId === userId,
    })),
    members,
    availableTags: tagRows.map((r) => r.name),
  };
}

export async function getNoteDetailForUser(
  noteId: string,
  userId: string,
): Promise<{ note: NoteDetail; members: OrgMemberOption[] }> {
  await assertCanReadNote(noteId, userId);

  const [row] = await db
    .select({
      id: notes.id,
      orgId: notes.orgId,
      authorId: notes.authorId,
      title: notes.title,
      content: notes.content,
      visibility: notes.visibility,
      currentVersion: notes.currentVersion,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
      authorEmail: users.email,
      authorDisplayName: users.displayName,
    })
    .from(notes)
    .innerJoin(users, eq(users.id, notes.authorId))
    .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
    .limit(1);

  if (!row) throw new NotesError("NOT_FOUND", "Note not found.");

  const [permissions, tagMap, shares, history, members] = await Promise.all([
    getNotePermission(noteId, userId),
    loadTagsForNotes([noteId]),
    loadShares(noteId),
    loadHistory(noteId),
    listOrgMembers(row.orgId),
  ]);

  return {
    note: {
      id: row.id,
      orgId: row.orgId,
      authorId: row.authorId,
      title: row.title,
      content: row.content,
      visibility: row.visibility,
      currentVersion: row.currentVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      author: { id: row.authorId, email: row.authorEmail, displayName: row.authorDisplayName },
      tags: tagMap.get(noteId) ?? [],
      shares,
      history,
      permissions,
    },
    members,
  };
}

export async function createNote(input: NoteCreateInput, userId: string) {
  await requireMemberRole(input.orgId, userId, "member");
  const tagNames = normalizeTags(input.tags);

  const note = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(notes)
      .values({
        orgId: input.orgId,
        authorId: userId,
        title: input.title.trim(),
        content: input.content ?? "",
        visibility: input.visibility,
        currentVersion: 1,
      })
      .returning({ id: notes.id, orgId: notes.orgId, title: notes.title, content: notes.content, visibility: notes.visibility });

    if (!created) throw new NotesError("INTERNAL", "Failed to create note.");

    await ensureTags(tx, input.orgId, created.id, tagNames);
    await insertVersion(tx, {
      noteId: created.id,
      version: 1,
      title: created.title,
      content: created.content,
      visibility: created.visibility,
      changedBy: userId,
      changeSummary: input.changeSummary ?? "Initial version",
    });

    return created;
  });

  await audit({
    action: "note.create",
    orgId: note.orgId,
    userId,
    resourceType: "note",
    resourceId: note.id,
    metadata: { visibility: note.visibility, tagCount: tagNames.length },
  });

  const detail = await getNoteDetailForUser(note.id, userId);
  return detail.note;
}

export async function updateNote(noteId: string, input: NoteUpdateInput, userId: string) {
  await assertCanWriteNote(noteId, userId);

  const { note: current } = await getNoteDetailForUser(noteId, userId);
  if (input.visibility && input.visibility !== current.visibility && !current.permissions.canShare) {
    throw new NotesError("FORBIDDEN", "Only the author or an org admin can change visibility.");
  }

  const nextVisibility = input.visibility ?? current.visibility;
  const nextTitle = input.title?.trim() ?? current.title;
  const nextContent = input.content ?? current.content;
  const nextTags = normalizeTags(input.tags ?? current.tags);

  const [updated] = await db.transaction(async (tx) => {
    // Lock the row to serialise concurrent version bumps.
    const [locked] = await tx
      .select({ currentVersion: notes.currentVersion, deletedAt: notes.deletedAt })
      .from(notes)
      .where(eq(notes.id, noteId))
      .for("update");
    if (!locked || locked.deletedAt) throw new NotesError("NOT_FOUND", "Note not found.");

    const nextVersion = locked.currentVersion + 1;

    if (nextVisibility !== "shared") {
      await tx.delete(noteShares).where(eq(noteShares.noteId, noteId));
    }

    const rows = await tx
      .update(notes)
      .set({ title: nextTitle, content: nextContent, visibility: nextVisibility, currentVersion: nextVersion })
      .where(eq(notes.id, noteId))
      .returning({ id: notes.id, orgId: notes.orgId, title: notes.title, content: notes.content, visibility: notes.visibility });

    await ensureTags(tx, current.orgId, noteId, nextTags);
    await insertVersion(tx, {
      noteId,
      version: nextVersion,
      title: nextTitle,
      content: nextContent,
      visibility: nextVisibility,
      changedBy: userId,
      changeSummary: input.changeSummary ?? null,
    });

    return rows;
  });

  if (!updated) throw new NotesError("NOT_FOUND", "Note not found.");

  await audit({
    action: "note.update",
    orgId: updated.orgId,
    userId,
    resourceType: "note",
    resourceId: noteId,
    metadata: { visibility: updated.visibility, changeSummary: input.changeSummary ?? null },
  });

  const detail = await getNoteDetailForUser(noteId, userId);
  return detail.note;
}

export async function deleteNote(noteId: string, userId: string) {
  const { note } = await getNoteDetailForUser(noteId, userId);
  if (!note.permissions.canDelete) {
    throw new NotesError("FORBIDDEN", "Only the author or an org admin can delete this note.");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(notes)
      .set({ deletedAt: new Date() })
      .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)));
    await tx.delete(noteTags).where(eq(noteTags.noteId, noteId));
    await tx.delete(noteShares).where(eq(noteShares.noteId, noteId));
  });

  await audit({
    action: "note.delete",
    orgId: note.orgId,
    userId,
    resourceType: "note",
    resourceId: noteId,
  });
}
