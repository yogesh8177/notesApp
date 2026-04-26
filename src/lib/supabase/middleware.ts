import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

/**
 * Refreshes the Supabase session on every request and forwards
 * Set-Cookie back to the browser. Called from `src/middleware.ts`.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touching getUser() ensures the JWT is refreshed if needed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Routes that don't require auth.
  const publicPaths = ["/sign-in", "/auth/callback", "/auth/sign-out", "/healthz"];
  const isPublic = publicPaths.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("redirect_to", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Bounce signed-in users off the sign-in page.
  if (user && request.nextUrl.pathname === "/sign-in") {
    const url = request.nextUrl.clone();
    url.pathname = "/orgs";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
