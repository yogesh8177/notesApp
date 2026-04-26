import { noteCreateSchema, notesListQuerySchema, toNotesErr, createNote, listNotesForUser, parseJson, parseQuery, requireApiUser } from "@/lib/notes";
import { ok, toResponse } from "@/lib/validation/result";

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return toResponse(auth.error);

  const url = new URL(request.url);
  const parsed = parseQuery(notesListQuerySchema, {
    orgId: url.searchParams.get("orgId") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    visibility: url.searchParams.get("visibility") ?? undefined,
    authorId: url.searchParams.get("authorId") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
  });
  if (!parsed.success) {
    return toResponse(toNotesErr(parsed.error));
  }

  try {
    const data = await listNotesForUser(parsed.data, auth.user.id);
    return toResponse(ok(data));
  } catch (error) {
    return toResponse(toNotesErr(error));
  }
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return toResponse(auth.error);

  const parsed = await parseJson(request, noteCreateSchema);
  if (!parsed.success) return toResponse(parsed.error);

  try {
    const data = await createNote(parsed.data, auth.user.id);
    return toResponse(ok(data));
  } catch (error) {
    return toResponse(toNotesErr(error));
  }
}
