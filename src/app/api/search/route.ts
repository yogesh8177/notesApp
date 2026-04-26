import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getMembership } from "@/lib/auth/org";
import { getCurrentUser } from "@/lib/auth/session";
import { parseSearchRequest, searchNotes } from "@/lib/search";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "unauthenticated", message: "Sign in to search notes." },
      { status: 401 },
    );
  }

  try {
    const orgId = request.nextUrl.searchParams.get("orgId") ?? "";
    const input = parseSearchRequest(request.nextUrl.searchParams, orgId);
    const membership = await getMembership(input.orgId, user.id);

    if (!membership) {
      return NextResponse.json(
        { error: "forbidden", message: "You do not belong to this org." },
        { status: 403 },
      );
    }

    const result = await searchNotes(input, {
      orgId: input.orgId,
      userId: user.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "invalid_query",
          message: error.issues[0]?.message ?? "Invalid search request.",
        },
        { status: 400 },
      );
    }

    throw error;
  }
}
