import { getCurrentUser } from "@/lib/auth/session";
import { err, fromZod, ok, toResponse } from "@/lib/validation/result";
import { listFilesForOrg, requireOrgFilesAccess } from "@/lib/files";
import { toFilesError } from "@/lib/files/errors";
import { filesListQuerySchema } from "@/lib/files/validation";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return toResponse(err("UNAUTHORIZED", "Sign in required"));
  }

  const parsed = filesListQuerySchema.safeParse({
    orgId: new URL(request.url).searchParams.get("orgId"),
  });
  if (!parsed.success) {
    return toResponse(fromZod(parsed.error));
  }

  try {
    const role = await requireOrgFilesAccess(parsed.data.orgId, user.id, "viewer");
    const items = await listFilesForOrg({
      orgId: parsed.data.orgId,
      userId: user.id,
      role,
    });

    return toResponse(
      ok({
        role,
        canUpload: role === "owner" || role === "admin" || role === "member",
        files: items,
      }),
    );
  } catch (error) {
    const fileError = toFilesError(error, "Could not load files");
    return toResponse(err(fileError.code, fileError.message, fileError.fields));
  }
}
