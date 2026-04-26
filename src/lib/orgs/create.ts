"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgs, memberships } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { audit } from "@/lib/log/audit";
import { err, fromZod, ok, toResponse } from "@/lib/validation/result";
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
  if (!parsed.success) return toResponse(fromZod(parsed.error));

  const { name, slug } = parsed.data;

  const [existing] = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(eq(orgs.slug, slug))
    .limit(1);
  if (existing) {
    return toResponse(err("CONFLICT", `The slug "${slug}" is already taken.`));
  }

  const [org] = await db.transaction(async (tx) => {
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

  return toResponse(ok({ id: org.id }));
}
