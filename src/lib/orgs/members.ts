import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { memberships, users, orgInvites } from "@/lib/db/schema";
import type { OrgRole } from "@/lib/db/schema";

export interface MemberRow {
  userId: string;
  email: string;
  displayName: string | null;
  role: OrgRole;
  joinedAt: Date;
}

export interface PendingInviteRow {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: Date;
  createdAt: Date;
}

/** List all active members of an org, sorted by join date. */
export async function listMembers(orgId: string): Promise<MemberRow[]> {
  return db
    .select({
      userId: memberships.userId,
      email: users.email,
      displayName: users.displayName,
      role: memberships.role,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .orderBy(memberships.createdAt);
}

/** List outstanding (non-expired, non-accepted) invites for an org. */
export async function listPendingInvites(orgId: string): Promise<PendingInviteRow[]> {
  return db
    .select({
      id: orgInvites.id,
      email: orgInvites.email,
      role: orgInvites.role,
      expiresAt: orgInvites.expiresAt,
      createdAt: orgInvites.createdAt,
    })
    .from(orgInvites)
    .where(
      and(
        eq(orgInvites.orgId, orgId),
        isNull(orgInvites.acceptedAt),
        // expiresAt > now — filter out expired; Drizzle sql can do this but
        // we fetch all non-accepted and filter in JS to avoid tz mismatch.
      ),
    )
    .orderBy(desc(orgInvites.createdAt))
    .then((rows) => rows.filter((r) => r.expiresAt > new Date()));
}
