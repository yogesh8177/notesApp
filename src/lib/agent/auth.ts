import { timingSafeEqual } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentTokens, memberships } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { hashToken, isWellFormedToken } from "@/lib/agent-tokens";
import { err, type Err } from "@/lib/validation/result";

/**
 * Bearer-token authentication for the agent memory bridge.
 *
 * Two valid token sources, tried in order:
 *
 *   1. **Token table (`agent_tokens`)** — preferred. Tokens generated through
 *      the org settings UI are stored as sha256 hashes here. Each token maps
 *      to (org_id, user_id). Cleartext tokens have the form `nat_<32 hex>`.
 *      Last-used timestamp is bumped on every successful auth.
 *
 *   2. **Env vars (`MEMORY_AGENT_TOKEN` + `_ORG_ID` + `_USER_ID`)** — fallback
 *      single-tenant model from v0. Constant-time compare. Kept so existing
 *      deployments don't break when this branch lands; new operators should
 *      mint tokens via the UI instead.
 *
 * Both paths verify that the principal user is still a current org member on
 * every call, so removing membership locks the agent out immediately without
 * requiring token revocation.
 */
export interface AgentPrincipal {
  orgId: string;
  userId: string;
  /** Token row that authenticated this request. Null when env-fallback was used. */
  tokenId: string | null;
  /** Human label of the token (or "env" for the fallback path). */
  tokenName: string;
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

async function principalFromTokenTable(
  presented: string,
): Promise<AgentAuthResult | null> {
  if (!isWellFormedToken(presented)) return null; // Wrong shape — let env path try.

  const hash = hashToken(presented);
  const [row] = await db
    .select({
      id: agentTokens.id,
      name: agentTokens.name,
      orgId: agentTokens.orgId,
      userId: agentTokens.userId,
      revokedAt: agentTokens.revokedAt,
    })
    .from(agentTokens)
    .where(and(eq(agentTokens.tokenHash, hash), isNull(agentTokens.revokedAt)))
    .limit(1);

  if (!row) return { ok: false, error: err("UNAUTHORIZED", "Invalid agent token.") };

  const [membership] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.orgId, row.orgId),
        eq(memberships.userId, row.userId),
      ),
    )
    .limit(1);

  if (!membership) {
    return {
      ok: false,
      error: err(
        "FORBIDDEN",
        "Token's principal user is no longer a member of the org.",
      ),
    };
  }

  // Best-effort touch — never block the request on a failed update.
  void db
    .update(agentTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(agentTokens.id, row.id))
    .catch(() => {});

  return {
    ok: true,
    principal: {
      orgId: row.orgId,
      userId: row.userId,
      tokenId: row.id,
      tokenName: row.name,
    },
  };
}

async function principalFromEnv(
  presented: string,
): Promise<AgentAuthResult | null> {
  const expected = env.MEMORY_AGENT_TOKEN;
  const orgId = env.MEMORY_AGENT_ORG_ID;
  const userId = env.MEMORY_AGENT_USER_ID;

  if (!expected || !orgId || !userId) return null;

  if (!constantTimeEquals(presented, expected)) {
    return { ok: false, error: err("UNAUTHORIZED", "Invalid agent token.") };
  }

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

  return {
    ok: true,
    principal: { orgId, userId, tokenId: null, tokenName: "env" },
  };
}

export async function requireAgentPrincipal(
  request: Request,
): Promise<AgentAuthResult> {
  const presented = bearerFromHeader(request.headers.get("authorization"));
  if (!presented) {
    return { ok: false, error: err("UNAUTHORIZED", "Missing Bearer token.") };
  }

  // Token-table path first. If the token isn't well-formed (`nat_` shape) the
  // table path returns null and we fall through to env. If the token IS well-
  // formed but doesn't match a row, the table path returns UNAUTHORIZED — we
  // do NOT then fall through to env because the caller clearly intended a
  // table token and shouldn't get a confusing "valid env match" response.
  const tableResult = await principalFromTokenTable(presented);
  if (tableResult) return tableResult;

  const envResult = await principalFromEnv(presented);
  if (envResult) return envResult;

  return { ok: false, error: err("UNAUTHORIZED", "Invalid agent token.") };
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
