import { getCurrentUser } from "@/lib/auth/session";
import { err, fromZod, ok, toResponse } from "@/lib/validation/result";
import { getFilesForNote, listFilesForOrg, MAX_FILES_PER_NOTE, requireOrgFilesAccess } from "@/lib/files";
import { toFilesError } from "@/lib/files/errors";
import { filesListQuerySchema, noteFilesQuerySchema } from "@/lib/files/validation";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return toResponse(err("UNAUTHORIZED", "Sign in required"));
  }

  const url = new URL(request.url);
  const noteId = url.searchParams.get("noteId");

  // Note-scoped file list — used by NoteFileUploader
  if (noteId) {
    const parsed = noteFilesQuerySchema.safeParse({ noteId });
    if (!parsed.success) {
      return toResponse(fromZod(parsed.error));
    }
    try {
      const items = await getFilesForNote(parsed.data.noteId, user.id);
      return toResponse(ok({ files: items, maxFiles: MAX_FILES_PER_NOTE }));
    } catch (error) {
      const fileError = toFilesError(error, "Could not load files for note");
      return toResponse(err(fileError.code, fileError.message, fileError.fields));
    }
  }

  // Org-scoped file list — used by the Files page
  const parsed = filesListQuerySchema.safeParse({
    orgId: url.searchParams.get("orgId"),
    cursor: url.searchParams.get("cursor") ?? undefined,
  });
  if (!parsed.success) {
    return toResponse(fromZod(parsed.error));
  }

  try {
    const role = await requireOrgFilesAccess(parsed.data.orgId, user.id, "viewer");
    const page = await listFilesForOrg({
      orgId: parsed.data.orgId,
      userId: user.id,
      role,
      cursor: parsed.data.cursor,
    });
    return toResponse(ok({
      role,
      canUpload: role === "owner" || role === "admin" || role === "member",
      files: page.items,
      nextCursor: page.nextCursor,
    }));
  } catch (error) {
    const fileError = toFilesError(error, "Could not load files");
    return toResponse(err(fileError.code, fileError.message, fileError.fields));
  }
}
