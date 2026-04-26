"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgs, memberships, users } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { audit } from "@/lib/log/audit";
import { err, fromZod, ok } from "@/lib/validation/result";
import { createOrgSchema, type CreateOrgInput } from "./schemas";

/**
 * Create a new org and make the caller its owner.
 *
 * Must use the service-role Drizzle client: the creator has no membership
 * yet when the INSERT runs so RLS on the memberships table would block
 * a user-scoped client.
 */
export async function createOrg(input: CreateOrgInput) {
  const user = await requireUser();
  const parsed = createOrgSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const { name, slug } = parsed.data;

  const [existing] = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(eq(orgs.slug, slug))
    .limit(1);
  if (existing) {
    return err("CONFLICT", `The slug "${slug}" is already taken.`);
  }

  const [org] = await db.transaction(async (tx) => {
    // Ensure the public.users profile row exists. The on_auth_user_created
    // trigger normally handles this, but it only fires on INSERT into auth.users.
    // Users created before the migration ran (e.g. via the Supabase dashboard)
    // or in environments where the trigger fired silently have no profile row,
    // causing the orgs.created_by FK to fail with 23503.
    await tx
      .insert(users)
      .values({
        id: user.id,
        email: user.email!,
        displayName: (user.user_metadata?.display_name as string | undefined) ?? null,
      })
      .onConflictDoNothing();

    const rows = await tx
      .insert(orgs)
      .values({ name, slug, createdBy: user.id })
      .returning({ id: orgs.id, name: orgs.name, slug: orgs.slug });

    await tx.insert(memberships).values({
      orgId: rows[0].id,
      userId: user.id,
      role: "owner",
    });

    return rows;
  });

  await audit({
    action: "org.create",
    orgId: org.id,
    userId: user.id,
    resourceType: "org",
    resourceId: org.id,
    metadata: { name: org.name, slug: org.slug },
  });

  return ok({ id: org.id });
}
