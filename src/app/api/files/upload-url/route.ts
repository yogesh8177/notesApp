import { getCurrentUser } from "@/lib/auth/session";
import { createUpload, requireOrgFilesAccess } from "@/lib/files";
import { toFilesError } from "@/lib/files/errors";
import { createUploadSchema } from "@/lib/files/validation";
import { err, fromZod, ok, toResponse } from "@/lib/validation/result";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return toResponse(err("UNAUTHORIZED", "Sign in required"));
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return toResponse(err("VALIDATION", "Invalid JSON body"));
  }

  const parsed = createUploadSchema.safeParse(payload);
  if (!parsed.success) {
    return toResponse(fromZod(parsed.error));
  }

  try {
    const role = await requireOrgFilesAccess(parsed.data.orgId, user.id, "member");
    const upload = await createUpload({
      ...parsed.data,
      userId: user.id,
      role,
    });

    return toResponse(ok(upload));
  } catch (error) {
    const fileError = toFilesError(error, "Could not prepare the upload");
    return toResponse(err(fileError.code, fileError.message, fileError.fields));
  }
}
