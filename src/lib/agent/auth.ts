import { timingSafeEqual } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { memberships } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { err, type Err } from "@/lib/validation/result";

/**
 * Bearer-token authentication for the agent memory bridge.
 *
 * v1 model: a single env-configured token that maps to one (org, user) service
 * principal. The principal must be a member of the org with at least `member`
 * role; we check that on every call so removing the membership immediately
 * locks the agent out without an env change.
 *
 * The Bearer-token path uses the Drizzle `db` client (RLS-bypassing). The
 * token IS the authentication boundary — see NOTES.md (2026-04-28) and
 * BUGS.md for the v2 plan to route through programmatic Supabase auth and
 * keep RLS in the loop.
 */
export interface AgentPrincipal {
  orgId: string;
  userId: string;
}

export type AgentAuthResult =
  | { ok: true; principal: AgentPrincipal }
  | { ok: false; error: Err };

function bearerFromHeader(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function requireAgentPrincipal(
  request: Request,
): Promise<AgentAuthResult> {
  const expected = env.MEMORY_AGENT_TOKEN;
  const orgId = env.MEMORY_AGENT_ORG_ID;
  const userId = env.MEMORY_AGENT_USER_ID;

  if (!expected || !orgId || !userId) {
    return {
      ok: false,
      error: err(
        "INTERNAL",
        "Agent memory bridge not configured on server (MEMORY_AGENT_* env vars missing).",
      ),
    };
  }

  const presented = bearerFromHeader(request.headers.get("authorization"));
  if (!presented || !constantTimeEquals(presented, expected)) {
    return { ok: false, error: err("UNAUTHORIZED", "Invalid agent token.") };
  }

  // Resist drift: the configured user must still be a member of the configured
  // org. Cheap query, runs once per agent call.
  const [membership] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .limit(1);

  if (!membership) {
    return {
      ok: false,
      error: err(
        "FORBIDDEN",
        "Configured agent principal is not a member of the configured org.",
      ),
    };
  }

  return { ok: true, principal: { orgId, userId } };
}

export function clientMeta(request: Request): {
  ip: string | null;
  userAgent: string | null;
} {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;
  return { ip, userAgent: request.headers.get("user-agent") };
}
