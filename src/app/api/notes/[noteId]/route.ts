import { getNoteDetailForUser, noteUpdateSchema, toNotesErr, updateNote, deleteNote, parseJson, requireApiUser } from "@/lib/notes";
import { ok, toResponse } from "@/lib/validation/result";

export async function GET(_: Request, { params }: { params: Promise<{ noteId: string }> }) {
  const auth = await requireApiUser();
  if (auth.error) return toResponse(auth.error);

  const { noteId } = await params;
  try {
    const data = await getNoteDetailForUser(noteId, auth.user.id);
    return toResponse(ok(data));
  } catch (error) {
    return toResponse(toNotesErr(error));
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ noteId: string }> }) {
  const auth = await requireApiUser();
  if (auth.error) return toResponse(auth.error);

  const parsed = await parseJson(request, noteUpdateSchema);
  if (!parsed.success) return toResponse(parsed.error);

  const { noteId } = await params;
  try {
    const data = await updateNote(noteId, parsed.data, auth.user.id);
    return toResponse(ok(data));
  } catch (error) {
    return toResponse(toNotesErr(error));
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ noteId: string }> }) {
  const auth = await requireApiUser();
  if (auth.error) return toResponse(auth.error);

  const { noteId } = await params;
  try {
    await deleteNote(noteId, auth.user.id);
    return toResponse(ok({ noteId }));
  } catch (error) {
    return toResponse(toNotesErr(error));
  }
}
