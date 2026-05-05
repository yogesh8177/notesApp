import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { audit } from "@/lib/log/audit";
import { ok, err, fromZod, toResponse } from "@/lib/validation/result";
import { syncNode } from "@/lib/graph/sync";
import { getDriver } from "@/lib/graph/client";
import { getMembership } from "@/lib/auth/org";
import type { GraphNodeType } from "@/lib/graph/types";

const bodySchema = z.object({
  type: z.enum(["Note", "User", "AgentSession", "ConversationTurn", "Tag", "AuditEvent"]),
  id: z.string().min(1),
  orgId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toResponse(err("UNAUTHORIZED", "Authentication required"));
  }

  if (!getDriver()) {
    return toResponse(err("UPSTREAM", "Neo4j unavailable — graph feature requires NEO4J_URI"));
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return toResponse(err("VALIDATION", "Invalid JSON body"));
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(fromZod(parsed.error));
  }

  const { type, id, orgId } = parsed.data;

  const membership = await getMembership(orgId, user.id);
  if (!membership) {
    return toResponse(err("FORBIDDEN", "Not a member of this org"));
  }

  try {
    await syncNode(type as GraphNodeType, id, orgId);

    await audit({
      action: "graph.sync",
      orgId,
      userId: user.id,
      resourceType: type,
      resourceId: id,
    });

    log.info({ type, id, orgId }, "graph.sync.triggered");

    return toResponse(ok({ synced: true, type, id, orgId }));
  } catch (error) {
    log.error({ error, type, id, orgId }, "graph.sync.route.error");
    return toResponse(err("INTERNAL", "Sync failed"));
  }
}
