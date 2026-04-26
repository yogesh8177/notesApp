"use server";

import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { memberships } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { requireOrgRole } from "@/lib/auth/org";
import { audit } from "@/lib/log/audit";
import { err, fromZod, ok, toResponse } from "@/lib/validation/result";
import { changeRoleSchema, type ChangeRoleInput } from "./schemas";

/**
 * Change a member's role.
 *
 * Requires admin access. Guards:
 * - Cannot demote the last owner (would leave the org with no owner).
 * - Self-demotion is allowed as long as at least one other owner remains.
 */
export async function changeRole(orgId: string, input: ChangeRoleInput) {
  await requireOrgRole(orgId, "admin");
  const user = await requireUser();
  const parsed = changeRoleSchema.safeParse(input);
  if (!parsed.success) return toResponse(fromZod(parsed.error));

  const { userId: targetUserId, role: newRole } = parsed.data;

  const [current] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, targetUserId)))
    .limit(1);

  if (!current) return toResponse(err("NOT_FOUND", "Member not found in this organisation."));

  const oldRole = current.role;

  if (oldRole === "owner" && newRole !== "owner") {
    const [{ ownerCount }] = await db
      .select({ ownerCount: count() })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner")));

    if (ownerCount <= 1) {
      return toResponse(
        err("UNPROCESSABLE", "Cannot demote the last owner. Promote another member to owner first."),
      );
    }
  }

  await db
    .update(memberships)
    .set({ role: newRole })
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, targetUserId)));

  revalidatePath(`/orgs/${orgId}/settings`);

  await audit({
    action: "org.role.change",
    orgId,
    userId: user.id,
    resourceType: "org",
    resourceId: orgId,
    metadata: { targetUserId, from: oldRole, to: newRole },
  });

  return toResponse(ok({}));
}

/**
 * Remove the calling user from the org.
 *
 * Guards against the last-owner case — must transfer ownership first.
 */
export async function leaveOrg(orgId: string) {
  const user = await requireUser();

  const [current] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, user.id)))
    .limit(1);

  if (!current) return toResponse(err("NOT_FOUND", "You are not a member of this organisation."));

  if (current.role === "owner") {
    const [{ ownerCount }] = await db
      .select({ ownerCount: count() })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner")));

    if (ownerCount <= 1) {
      return toResponse(
        err("UNPROCESSABLE", "You are the last owner. Transfer ownership before leaving."),
      );
    }
  }

  await db
    .delete(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, user.id)));

  await audit({
    action: "org.switch",
    orgId,
    userId: user.id,
    resourceType: "org",
    resourceId: orgId,
    metadata: { action: "leave" },
  });

  revalidatePath("/orgs");
  return toResponse(ok({}));
}
