import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { createDownloadUrl } from "@/lib/files";
import { toFilesError } from "@/lib/files/errors";
import { deleteFileParamsSchema } from "@/lib/files/validation";
import { err, fromZod, toResponse } from "@/lib/validation/result";

export async function GET(
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
    const signedUrl = await createDownloadUrl(parsed.data.fileId, user.id);
    return NextResponse.redirect(signedUrl);
  } catch (error) {
    const fileError = toFilesError(error, "Could not create a download URL");
    return toResponse(err(fileError.code, fileError.message, fileError.fields));
  }
}
