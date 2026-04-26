"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgInvites } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { requireOrgRole } from "@/lib/auth/org";
import { audit } from "@/lib/log/audit";
import { err, fromZod, ok, toResponse } from "@/lib/validation/result";
import { log } from "@/lib/log";
import { env } from "@/lib/env";
import { inviteMemberSchema, type InviteMemberInput } from "./schemas";

/**
 * Invite a new member to the org by email.
 *
 * Requires at least admin role. Generates a cryptographically random token
 * (crypto.randomUUID), stores an org_invites row expiring in 7 days, and
 * logs the invite link to the audit trail. When an email provider is wired
 * (EMAIL_DESTINATION env), extend this function to send the email.
 */
export async function inviteMember(orgId: string, input: InviteMemberInput) {
  await requireOrgRole(orgId, "admin");
  const user = await requireUser();
  const parsed = inviteMemberSchema.safeParse(input);
  if (!parsed.success) return toResponse(fromZod(parsed.error));

  const { email, role } = parsed.data;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const token = crypto.randomUUID();

  const [invite] = await db
    .insert(orgInvites)
    .values({ orgId, email, role, token, invitedBy: user.id, expiresAt })
    .returning({ id: orgInvites.id, token: orgInvites.token });

  const inviteLink = `${env.NEXT_PUBLIC_APP_URL}/orgs/invite/${invite.token}`;

  await audit({
    action: "org.invite",
    orgId,
    userId: user.id,
    resourceType: "org",
    resourceId: orgId,
    metadata: { email, role, inviteLink },
  });

  // Invite link is persisted in audit_log. Email sending is opt-in via env.
  log.info({ orgId, email, role }, "org invite created — link in audit_log");

  return toResponse(ok({ inviteLink }));
}

/**
 * Accept an invite by token.
 *
 * Validates expiry, checks the signed-in user's email matches the invite,
 * and inserts a membership row. Idempotent on conflict (re-accepting is a no-op).
 */
export async function acceptInvite(token: string) {
  const user = await requireUser();

  const [invite] = await db
    .select({
      id: orgInvites.id,
      orgId: orgInvites.orgId,
      email: orgInvites.email,
      role: orgInvites.role,
      expiresAt: orgInvites.expiresAt,
      acceptedAt: orgInvites.acceptedAt,
    })
    .from(orgInvites)
    .where(eq(orgInvites.token, token))
    .limit(1);

  if (!invite) return toResponse(err("NOT_FOUND", "Invite not found or already used."));
  if (invite.acceptedAt) return toResponse(err("CONFLICT", "This invite has already been accepted."));
  if (invite.expiresAt < new Date()) return toResponse(err("UNPROCESSABLE", "This invite has expired."));

  if (invite.email !== user.email) {
    return toResponse(
      err("FORBIDDEN", `This invite is for ${invite.email}. You are signed in as ${user.email}.`),
    );
  }

  const { memberships } = await import("@/lib/db/schema");

  await db.transaction(async (tx) => {
    await tx
      .insert(memberships)
      .values({ orgId: invite.orgId, userId: user.id, role: invite.role })
      .onConflictDoNothing();
    await tx
      .update(orgInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(orgInvites.id, invite.id));
  });

  await audit({
    action: "org.invite.accept",
    orgId: invite.orgId,
    userId: user.id,
    resourceType: "org",
    resourceId: invite.orgId,
    metadata: { email: invite.email, role: invite.role },
  });

  return toResponse(ok({ orgId: invite.orgId }));
}
