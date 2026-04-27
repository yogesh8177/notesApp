import type { NextRequest } from "next/server";

/**
 * Build an absolute redirect URL using the public-facing host.
 *
 * Behind Railway's proxy, request.nextUrl has host=0.0.0.0:PORT (internal).
 * x-forwarded-host carries the real public domain; x-forwarded-proto carries
 * the real scheme. Fall back to request.nextUrl only in local dev where no
 * proxy is present.
 */
export function publicUrl(path: string, request: NextRequest): URL {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";

  const base = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : request.nextUrl.origin;

  return new URL(path, base);
}
