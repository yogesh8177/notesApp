import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/log/audit";

/**
 * OAuth / magic-link callback. Exchanges the `code` for a session, then
 * redirects to the validated `redirect_to`.
 *
 * Security: redirect_to MUST be a same-origin path. We strip protocol/host.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  const code = url.searchParams.get("code");
  const rawRedirect = url.searchParams.get("redirect_to") ?? "/orgs";
  const safeRedirect = rawRedirect.startsWith("/") ? rawRedirect : "/orgs";

  if (!code) {
    url.pathname = "/sign-in";
    url.searchParams.set("error", "missing_code");
    return NextResponse.redirect(url);
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
    url.pathname = "/sign-in";
    url.search = `?error=${encodeURIComponent(error.message)}`;
    return NextResponse.redirect(url);
  }

  await audit({
    action: "auth.signin",
    userId: data.user?.id,
    metadata: { method: "magic-link" },
    ip: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  url.pathname = safeRedirect;
  url.search = "";
  return NextResponse.redirect(url);
}
