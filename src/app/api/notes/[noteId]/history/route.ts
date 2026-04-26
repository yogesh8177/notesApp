import { buildVersionDiff, getNoteVersionsForUser, historyQuerySchema, parseQuery, requireApiUser, toNotesErr } from "@/lib/notes";
import { ok, toResponse } from "@/lib/validation/result";

export async function GET(request: Request, { params }: { params: Promise<{ noteId: string }> }) {
  const auth = await requireApiUser();
  if (auth.error) return toResponse(auth.error);

  const { noteId } = await params;
  const url = new URL(request.url);
  const parsed = parseQuery(historyQuerySchema, {
    version: url.searchParams.get("version") ?? undefined,
    compareTo: url.searchParams.get("compareTo") ?? undefined,
  });
  if (!parsed.success) {
    return toResponse(toNotesErr(parsed.error));
  }

  try {
    const data = await getNoteVersionsForUser(noteId, auth.user.id);
    const selectedVersion = parsed.data.version
      ? data.versions.find((version) => version.version === parsed.data.version)
      : undefined;
    const compareVersion = parsed.data.compareTo
      ? data.versions.find((version) => version.version === parsed.data.compareTo)
      : undefined;

    const diff =
      selectedVersion && compareVersion
        ? buildVersionDiff(compareVersion, selectedVersion)
        : undefined;

    return toResponse(
      ok({
        ...data,
        diff,
        selectedVersion: selectedVersion ?? null,
        compareVersion: compareVersion ?? null,
      }),
    );
  } catch (error) {
    return toResponse(toNotesErr(error));
  }
}
