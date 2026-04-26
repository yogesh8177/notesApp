import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { memberships, orgs, type OrgRole } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "./session";

/**
 * Org-context resolution.
 *
 * Active org is derived from the URL parameter `[orgId]` — we always pass it
 * explicitly through the call chain rather than reading from a cookie. This
 * avoids the "stale cookie reads wrong org" class of bugs.
 *
 * Cookie `active_org_id` is informational only — used by the org switcher to
 * decide where to land users on /orgs. NEVER trusted for authorization.
 */
const ROLE_RANK: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

export interface OrgContext {
  orgId: string;
  userId: string;
  role: OrgRole;
}

/**
 * Resolve the user's role in the given org. Returns null if not a member.
 */
export const getMembership = cache(async (orgId: string, userId: string) => {
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .limit(1);
  return row ?? null;
});

/**
 * Require an authenticated user with at least `minRole` in the given org.
 * Redirects to /sign-in if not authenticated, /orgs if not a member.
 *
 * USE THIS at the top of every org-scoped server component / action.
 */
export async function requireOrgRole(
  orgId: string,
  minRole: OrgRole = "viewer",
): Promise<OrgContext> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/sign-in");
  }
  const m = await getMembership(orgId, user.id);
  if (!m) {
    redirect("/orgs");
  }
  if (ROLE_RANK[m.role] < ROLE_RANK[minRole]) {
    // Member but insufficient role — surface to UI; module agents convert
    // this into a 403 page. For now, throw so it's loud.
    throw new ForbiddenError(
      `Requires role ${minRole} in org ${orgId}; user has ${m.role}`,
    );
  }
  return { orgId, userId: user.id, role: m.role };
}

/**
 * List all orgs the current user is a member of, with their role.
 * Used by /orgs and the org switcher.
 */
export async function listMyOrgs(userId: string) {
  return db
    .select({
      id: orgs.id,
      name: orgs.name,
      slug: orgs.slug,
      role: memberships.role,
    })
    .from(orgs)
    .innerJoin(memberships, eq(memberships.orgId, orgs.id))
    .where(eq(memberships.userId, userId));
}

export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN";
  constructor(msg: string) {
    super(msg);
    this.name = "ForbiddenError";
  }
}
