import { deleteFile } from "@/lib/files";
import { toFilesError } from "@/lib/files/errors";
import { deleteFileParamsSchema } from "@/lib/files/validation";
import { getCurrentUser } from "@/lib/auth/session";
import { err, fromZod, ok, toResponse } from "@/lib/validation/result";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return toResponse(err("UNAUTHORIZED", "Sign in required"));
  }

  const parsed = deleteFileParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return toResponse(fromZod(parsed.error));
  }

  try {
    await deleteFile(parsed.data.fileId, user.id);
    return toResponse(ok({ deleted: true }));
  } catch (error) {
    const fileError = toFilesError(error, "Could not delete the file");
    return toResponse(err(fileError.code, fileError.message, fileError.fields));
  }
}
