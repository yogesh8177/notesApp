"use server";

import { revalidatePath } from "next/cache";
import { desc, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { assertCanWriteNote } from "@/lib/auth/permissions";
import { db } from "@/lib/db/client";
import { noteVersions, notes } from "@/lib/db/schema";
import { compactCheckpoints } from "@/lib/ai/compact";
import { audit } from "@/lib/log/audit";
import { log } from "@/lib/log";
import { err, ok } from "@/lib/validation/result";
import type { Result } from "@/lib/validation/result";

const MAX_VERSIONS = 20;

export async function compactHistory(
  noteId: string,
  orgId: string,
): Promise<Result<{ version: number }>> {
  const user = await requireUser(`/orgs/${orgId}/notes/${noteId}/dashboard`);

  try {
    await assertCanWriteNote(noteId, user.id);
  } catch {
    return err("FORBIDDEN", "You do not have permission to modify this note");
  }

  const [note] = await db
    .select({
      id: notes.id,
      orgId: notes.orgId,
      title: notes.title,
      currentVersion: notes.currentVersion,
      deletedAt: notes.deletedAt,
      visibility: notes.visibility,
      authorId: notes.authorId,
    })
    .from(notes)
    .where(eq(notes.id, noteId))
    .limit(1);

  if (!note || note.deletedAt) return err("NOT_FOUND", "Note not found");
  if (note.orgId !== orgId) return err("FORBIDDEN", "Access denied");

  const versions = await db
    .select({ version: noteVersions.version, content: noteVersions.content })
    .from(noteVersions)
    .where(eq(noteVersions.noteId, noteId))
    .orderBy(desc(noteVersions.version))
    .limit(MAX_VERSIONS);

  if (versions.length < 2) {
    return err("VALIDATION", "Not enough history to compact");
  }

  const ordered = [...versions].reverse();

  try {
    const result = await compactCheckpoints(ordered);

    const [updated] = await db
      .update(notes)
      .set({
        content: result.content,
        currentVersion: sql`${notes.currentVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(notes.id, noteId))
      .returning({ nextVersion: notes.currentVersion });

    await db.insert(noteVersions).values({
      noteId,
      version: updated.nextVersion,
      title: note.title,
      content: result.content,
      visibility: note.visibility,
      changedBy: user.id,
      changeSummary: `compact:v${ordered[0].version}-v${ordered.at(-1)!.version}`,
    });

    await audit({
      action: "agent.session.compact",
      orgId,
      userId: user.id,
      resourceType: "note",
      resourceId: noteId,
      metadata: {
        versionCount: versions.length,
        newVersion: updated.nextVersion,
        model: result.model,
      },
    });

    revalidatePath(`/orgs/${orgId}/notes/${noteId}/dashboard`);
    return ok({ version: updated.nextVersion });
  } catch (e) {
    log.error({ noteId, err: e }, "agent.session.compact.failed");
    return err("INTERNAL", "Compact failed");
  }
}
