import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/log/audit";
import { publicUrl } from "@/lib/auth/public-url";

/**
 * OAuth / magic-link callback. Exchanges the `code` for a session, then
 * redirects to the validated `redirect_to`.
 *
 * Security: redirect_to MUST be a same-origin path. We strip protocol/host.
 */
export async function GET(request: NextRequest) {
  const incomingUrl = request.nextUrl;
  const code = incomingUrl.searchParams.get("code");
  const rawRedirect = incomingUrl.searchParams.get("redirect_to") ?? "/orgs";
  const safeRedirect = rawRedirect.startsWith("/") ? rawRedirect : "/orgs";

  if (!code) {
    return NextResponse.redirect(
      publicUrl(`/sign-in?error=missing_code`, request),
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    await audit({
      action: "auth.signin.fail",
      metadata: { reason: error.message },
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });
    return NextResponse.redirect(
      publicUrl(`/sign-in?error=${encodeURIComponent(error.message)}`, request),
    );
  }

  await audit({
    action: "auth.signin",
    userId: data.user?.id,
    metadata: { method: "magic-link" },
    ip: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.redirect(publicUrl(safeRedirect, request));
}
