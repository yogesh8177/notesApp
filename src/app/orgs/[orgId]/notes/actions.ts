"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
/** Next.js stamps all redirect() throws with this digest prefix. */
function isRedirectError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "digest" in e &&
    typeof (e as { digest: unknown }).digest === "string" &&
    (e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
import { requireUser } from "@/lib/auth/session";
import {
  createNote,
  deleteNote,
  noteCreateSchema,
  noteShareSchema,
  noteUpdateSchema,
  toNotesErr,
  updateNote,
  upsertNoteShare,
  removeNoteShare,
} from "@/lib/notes";

function tagsFromValue(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function withFlash(path: string, key: "message" | "error", value: string) {
  return `${path}?${key}=${encodeURIComponent(value)}`;
}

function revalidateNotes(orgId: string, noteId?: string) {
  revalidatePath(`/orgs/${orgId}/notes`);
  if (noteId) {
    revalidatePath(`/orgs/${orgId}/notes/${noteId}`);
    revalidatePath(`/orgs/${orgId}/notes/${noteId}/history`);
  }
}

export async function createNoteAction(orgId: string, formData: FormData) {
  const user = await requireUser(`/orgs/${orgId}/notes`);
  const parsed = noteCreateSchema.safeParse({
    orgId,
    title: formData.get("title"),
    content: formData.get("content"),
    visibility: formData.get("visibility"),
    tags: tagsFromValue(formData.get("tags")),
    changeSummary: formData.get("changeSummary"),
  });

  if (!parsed.success) {
    redirect(withFlash(`/orgs/${orgId}/notes`, "error", "Could not create note. Check the fields and try again."));
  }

  try {
    const note = await createNote(parsed.data, user.id);
    revalidateNotes(orgId, note.id);
    redirect(withFlash(`/orgs/${orgId}/notes/${note.id}`, "message", "Note created."));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(withFlash(`/orgs/${orgId}/notes`, "error", toNotesErr(error).message));
  }
}

export async function updateNoteAction(orgId: string, noteId: string, formData: FormData) {
  const user = await requireUser(`/orgs/${orgId}/notes/${noteId}`);
  const parsed = noteUpdateSchema.safeParse({
    title: formData.get("title"),
    content: formData.get("content"),
    visibility: formData.get("visibility") || undefined,
    tags: tagsFromValue(formData.get("tags")),
    changeSummary: formData.get("changeSummary") || undefined,
  });

  if (!parsed.success) {
    redirect(withFlash(`/orgs/${orgId}/notes/${noteId}`, "error", "Could not save note changes."));
  }

  try {
    await updateNote(noteId, parsed.data, user.id);
    revalidateNotes(orgId, noteId);
    redirect(withFlash(`/orgs/${orgId}/notes/${noteId}`, "message", "Note updated."));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(withFlash(`/orgs/${orgId}/notes/${noteId}`, "error", toNotesErr(error).message));
  }
}

export async function deleteNoteAction(orgId: string, noteId: string) {
  const user = await requireUser(`/orgs/${orgId}/notes/${noteId}`);
  try {
    await deleteNote(noteId, user.id);
    revalidateNotes(orgId, noteId);
    redirect(withFlash(`/orgs/${orgId}/notes`, "message", "Note deleted."));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(withFlash(`/orgs/${orgId}/notes/${noteId}`, "error", toNotesErr(error).message));
  }
}

export async function upsertShareAction(orgId: string, noteId: string, formData: FormData) {
  const user = await requireUser(`/orgs/${orgId}/notes/${noteId}`);
  const parsed = noteShareSchema.safeParse({
    sharedWithUserId: formData.get("sharedWithUserId"),
    permission: formData.get("permission"),
  });

  if (!parsed.success) {
    redirect(withFlash(`/orgs/${orgId}/notes/${noteId}`, "error", "Could not update sharing settings."));
  }

  try {
    await upsertNoteShare(noteId, parsed.data, user.id);
    revalidateNotes(orgId, noteId);
    redirect(withFlash(`/orgs/${orgId}/notes/${noteId}`, "message", "Share updated."));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(withFlash(`/orgs/${orgId}/notes/${noteId}`, "error", toNotesErr(error).message));
  }
}

export async function removeShareAction(orgId: string, noteId: string, shareId: string) {
  const user = await requireUser(`/orgs/${orgId}/notes/${noteId}`);
  try {
    await removeNoteShare(noteId, shareId, user.id);
    revalidateNotes(orgId, noteId);
    redirect(withFlash(`/orgs/${orgId}/notes/${noteId}`, "message", "Share removed."));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(withFlash(`/orgs/${orgId}/notes/${noteId}`, "error", toNotesErr(error).message));
  }
}
