/**
 * Version history: load the full version list for a note the caller can read.
 * Permission rule: access to past versions requires can_read_note *now*.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { noteVersions } from "@/lib/db/schema";
import { assertCanReadNote } from "@/lib/auth/permissions";
import { NotesError } from "./errors";
import { loadHistory } from "./queries";

export async function getNoteVersionsForUser(noteId: string, userId: string) {
  await assertCanReadNote(noteId, userId);

  const history = await loadHistory(noteId);
  if (history.length === 0) {
    throw new NotesError("NOT_FOUND", "No versions found for this note.");
  }

  const versions = await db
    .select({
      version: noteVersions.version,
      title: noteVersions.title,
      content: noteVersions.content,
      visibility: noteVersions.visibility,
      changeSummary: noteVersions.changeSummary,
      createdAt: noteVersions.createdAt,
    })
    .from(noteVersions)
    .where(eq(noteVersions.noteId, noteId))
    .orderBy(desc(noteVersions.version));

  return { history, versions };
}
