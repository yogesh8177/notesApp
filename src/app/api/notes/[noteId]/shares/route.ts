import { getNoteDetailForUser, noteShareSchema, parseJson, requireApiUser, toNotesErr, upsertNoteShare } from "@/lib/notes";
import { ok, toResponse } from "@/lib/validation/result";

export async function GET(_: Request, { params }: { params: Promise<{ noteId: string }> }) {
  const auth = await requireApiUser();
  if (auth.error) return toResponse(auth.error);

  const { noteId } = await params;
  try {
    const data = await getNoteDetailForUser(noteId, auth.user.id);
    return toResponse(ok({ shares: data.note.shares, members: data.members }));
  } catch (error) {
    return toResponse(toNotesErr(error));
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ noteId: string }> }) {
  const auth = await requireApiUser();
  if (auth.error) return toResponse(auth.error);

  const parsed = await parseJson(request, noteShareSchema);
  if (!parsed.success) return toResponse(parsed.error);

  const { noteId } = await params;
  try {
    const data = await upsertNoteShare(noteId, parsed.data, auth.user.id);
    return toResponse(ok({ shares: data.note.shares, members: data.members, note: data.note }));
  } catch (error) {
    return toResponse(toNotesErr(error));
  }
}
