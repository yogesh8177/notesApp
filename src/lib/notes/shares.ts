/**
 * Note sharing: upsert a share (view/edit) and remove a share.
 * Both operations may promote/demote note visibility and emit an audit event.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { noteShares, notes } from "@/lib/db/schema";
import { assertCanShareNote } from "@/lib/auth/permissions";
import { audit } from "@/lib/log/audit";
import { NotesError } from "./errors";
import type { NoteShareInput } from "./schemas";
import { getNoteDetailForUser } from "./crud";
import { insertVersion } from "./queries";

export async function upsertNoteShare(noteId: string, input: NoteShareInput, userId: string) {
  await assertCanShareNote(noteId, userId);

  const { note: detail, members } = await getNoteDetailForUser(noteId, userId);
  if (detail.authorId === input.sharedWithUserId) {
    throw new NotesError("CONFLICT", "The author already has access to this note.");
  }
  const memberIds = new Set(members.map((m) => m.id));
  if (!memberIds.has(input.sharedWithUserId)) {
    throw new NotesError("FORBIDDEN", "Shares must stay within the note's organisation.");
  }

  await db.transaction(async (tx) => {
    // Lock row to serialise concurrent visibility bumps.
    const [locked] = await tx
      .select({ currentVersion: notes.currentVersion, visibility: notes.visibility })
      .from(notes)
      .where(eq(notes.id, noteId))
      .for("update");
    if (!locked) throw new NotesError("NOT_FOUND", "Note not found.");

    await tx
      .insert(noteShares)
      .values({
        noteId,
        sharedWithUserId: input.sharedWithUserId,
        permission: input.permission,
        sharedBy: userId,
      })
      .onConflictDoUpdate({
        target: [noteShares.noteId, noteShares.sharedWithUserId],
        set: { permission: input.permission, sharedBy: userId },
      });

    // Only bump version if this is the first share (private→shared or org→shared).
    if (locked.visibility !== "shared") {
      const nextVersion = locked.currentVersion + 1;
      await tx
        .update(notes)
        .set({ visibility: "shared", currentVersion: nextVersion })
        .where(eq(notes.id, noteId));
      await insertVersion(tx, {
        noteId,
        version: nextVersion,
        title: detail.title,
        content: detail.content,
        visibility: "shared",
        changedBy: userId,
        changeSummary: "Changed visibility to shared",
      });
    }
  });

  await audit({
    action: "note.share",
    orgId: detail.orgId,
    userId,
    resourceType: "note",
    resourceId: noteId,
    metadata: { sharedWithUserId: input.sharedWithUserId, permission: input.permission },
  });

  return getNoteDetailForUser(noteId, userId);
}

export async function removeNoteShare(noteId: string, shareId: string, userId: string) {
  await assertCanShareNote(noteId, userId);

  const [share] = await db
    .select({ id: noteShares.id, noteId: noteShares.noteId, sharedWithUserId: noteShares.sharedWithUserId })
    .from(noteShares)
    .where(eq(noteShares.id, shareId))
    .limit(1);

  if (!share || share.noteId !== noteId) {
    throw new NotesError("NOT_FOUND", "Share not found.");
  }

  const { note } = await getNoteDetailForUser(noteId, userId);
  await db.delete(noteShares).where(eq(noteShares.id, shareId));

  await audit({
    action: "note.unshare",
    orgId: note.orgId,
    userId,
    resourceType: "note",
    resourceId: noteId,
    metadata: { sharedWithUserId: share.sharedWithUserId },
  });

  return getNoteDetailForUser(noteId, userId);
}
