import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentTokens, memberships, users } from "@/lib/db/schema";
import { audit } from "@/lib/log/audit";
import { err, ok, type Result } from "@/lib/validation/result";
import { generateToken } from "./hash";
import type { CreateTokenInput } from "./schemas";

export interface AgentTokenSummary {
  id: string;
  name: string;
  displayPrefix: string;
  principal: { id: string; email: string; displayName: string | null };
  createdBy: { id: string; email: string };
  createdAt: Date;
  lastUsedAt: Date | null;
  revoked: boolean;
}

export interface CreatedTokenResult extends AgentTokenSummary {
  /** Cleartext token. Returned ONLY at creation; never re-fetchable. */
  cleartext: string;
}

/**
 * Create a new agent token. Returns the cleartext exactly once — the caller
 * (UI) must show it to the admin and warn them it won't be displayed again.
 *
 * Permission: caller must be an owner/admin of `input.orgId`. The principal
 * (`input.userId`) must be a member of the same org.
 */
export async function createAgentToken(
  input: CreateTokenInput,
  callerUserId: string,
): Promise<Result<CreatedTokenResult>> {
  const callerRole = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.orgId, input.orgId),
        eq(memberships.userId, callerUserId),
      ),
    )
    .limit(1);
  const role = callerRole[0]?.role;
  if (role !== "owner" && role !== "admin") {
    return err("FORBIDDEN", "Only org owners or admins can manage agent tokens.");
  }

  const principal = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.orgId, input.orgId),
        eq(memberships.userId, input.userId),
      ),
    )
    .limit(1);
  if (principal.length === 0) {
    return err(
      "VALIDATION",
      "Selected principal is not a member of this organisation.",
    );
  }

  const { cleartext, displayPrefix, hash } = generateToken();

  const [row] = await db
    .insert(agentTokens)
    .values({
      orgId: input.orgId,
      userId: input.userId,
      name: input.name,
      tokenPrefix: displayPrefix,
      tokenHash: hash,
      createdBy: callerUserId,
    })
    .returning({
      id: agentTokens.id,
      name: agentTokens.name,
      tokenPrefix: agentTokens.tokenPrefix,
      createdAt: agentTokens.createdAt,
    });

  await audit({
    action: "agent.token.create",
    orgId: input.orgId,
    userId: callerUserId,
    resourceType: "agent_token",
    resourceId: row.id,
    metadata: {
      tokenName: input.name,
      principalUserId: input.userId,
      displayPrefix,
    },
  });

  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(users)
    .where(inArray(users.id, [input.userId, callerUserId]));
  const userMap = new Map(userRows.map((u) => [u.id, u]));
  const principalRow = userMap.get(input.userId);
  const callerRow = userMap.get(callerUserId);

  return ok({
    id: row.id,
    name: row.name,
    displayPrefix: row.tokenPrefix,
    principal: {
      id: input.userId,
      email: principalRow?.email ?? "",
      displayName: principalRow?.displayName ?? null,
    },
    createdBy: { id: callerUserId, email: callerRow?.email ?? "" },
    createdAt: row.createdAt,
    lastUsedAt: null,
    revoked: false,
    cleartext,
  });
}

/** List tokens for an org, newest first. Active and revoked included. */
export async function listAgentTokens(
  orgId: string,
  callerUserId: string,
): Promise<Result<AgentTokenSummary[]>> {
  const callerRole = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(eq(memberships.orgId, orgId), eq(memberships.userId, callerUserId)),
    )
    .limit(1);
  const role = callerRole[0]?.role;
  if (role !== "owner" && role !== "admin") {
    return err("FORBIDDEN", "Only org owners or admins can view agent tokens.");
  }

  const principal = users;
  const creator = users;

  const rows = await db
    .select({
      id: agentTokens.id,
      name: agentTokens.name,
      displayPrefix: agentTokens.tokenPrefix,
      createdAt: agentTokens.createdAt,
      lastUsedAt: agentTokens.lastUsedAt,
      revokedAt: agentTokens.revokedAt,
      principalId: agentTokens.userId,
      createdById: agentTokens.createdBy,
    })
    .from(agentTokens)
    .where(eq(agentTokens.orgId, orgId))
    .orderBy(desc(agentTokens.createdAt));

  if (rows.length === 0) return ok([]);

  const userIds = Array.from(
    new Set(rows.flatMap((r) => [r.principalId, r.createdById])),
  );
  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(users)
    .where(inArray(users.id, userIds));
  const userMap = new Map(
    userRows.map((u) => [
      u.id,
      { email: u.email, displayName: u.displayName },
    ]),
  );

  return ok(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      displayPrefix: r.displayPrefix,
      principal: {
        id: r.principalId,
        email: userMap.get(r.principalId)?.email ?? "",
        displayName: userMap.get(r.principalId)?.displayName ?? null,
      },
      createdBy: {
        id: r.createdById,
        email: userMap.get(r.createdById)?.email ?? "",
      },
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
      revoked: r.revokedAt !== null,
    })),
  );
}

/**
 * Revoke a token. Idempotent — revoking an already-revoked token is a no-op
 * and returns ok. Cannot un-revoke (issue a new token instead).
 */
export async function revokeAgentToken(
  orgId: string,
  tokenId: string,
  callerUserId: string,
): Promise<Result<{ id: string }>> {
  const callerRole = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(eq(memberships.orgId, orgId), eq(memberships.userId, callerUserId)),
    )
    .limit(1);
  const role = callerRole[0]?.role;
  if (role !== "owner" && role !== "admin") {
    return err("FORBIDDEN", "Only org owners or admins can revoke agent tokens.");
  }

  const [updated] = await db
    .update(agentTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(agentTokens.id, tokenId),
        eq(agentTokens.orgId, orgId),
        isNull(agentTokens.revokedAt),
      ),
    )
    .returning({ id: agentTokens.id });

  if (updated) {
    await audit({
      action: "agent.token.revoke",
      orgId,
      userId: callerUserId,
      resourceType: "agent_token",
      resourceId: tokenId,
    });
  }

  return ok({ id: tokenId });
}
