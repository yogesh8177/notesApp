import { removeNoteShare, requireApiUser, toNotesErr } from "@/lib/notes";
import { ok, toResponse } from "@/lib/validation/result";

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ noteId: string; shareId: string }> },
) {
  const auth = await requireApiUser();
  if (auth.error) return toResponse(auth.error);

  const { noteId, shareId } = await params;
  try {
    const data = await removeNoteShare(noteId, shareId, auth.user.id);
    return toResponse(ok({ shares: data.note.shares, note: data.note }));
  } catch (error) {
    return toResponse(toNotesErr(error));
  }
}
