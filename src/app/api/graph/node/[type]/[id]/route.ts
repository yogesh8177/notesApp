import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { ok, err, toResponse } from "@/lib/validation/result";
import { syncNode } from "@/lib/graph/sync";
import { getNodeNeighborhood, isStale, type NeighborhoodOptions } from "@/lib/graph/queries";
import { getDriver, ensureIndexes } from "@/lib/graph/client";
import { getMembership } from "@/lib/auth/org";
import type { GraphNodeType } from "@/lib/graph/types";

const VALID_TYPES: GraphNodeType[] = [
  "Note",
  "User",
  "AgentSession",
  "ConversationTurn",
  "Tag",
  "AuditEvent",
];

const querySchema = z.object({
  depth: z.coerce.number().int().min(1).max(4).optional().default(2),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  orgId: z.string().uuid(), // required — scopes traversal to this org and verifies membership
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toResponse(err("UNAUTHORIZED", "Authentication required"));
  }

  const { type, id } = await params;

  if (!VALID_TYPES.includes(type as GraphNodeType)) {
    return toResponse(err("VALIDATION", `Invalid node type: ${type}`));
  }

  const searchParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(searchParams);
  if (!parsed.success) {
    return toResponse(err("VALIDATION", "Invalid query parameters"));
  }

  const { depth, limit, orgId, from, to } = parsed.data;

  // Verify the requesting user is a member of the org they're scoping to.
  const membership = await getMembership(orgId, user.id);
  if (!membership) {
    return toResponse(err("FORBIDDEN", "Not a member of this org"));
  }

  const queryOpts: NeighborhoodOptions = { orgId, from, to };

  if (!getDriver()) {
    return NextResponse.json(
      { ok: false, code: "UPSTREAM", message: "Neo4j unavailable — graph feature requires NEO4J_URI" },
      { status: 503 }
    );
  }

  // Ensure indexes exist — no-op after first success, fire-and-forget
  void ensureIndexes();

  try {
    let data = await getNodeNeighborhood(type as GraphNodeType, id, depth, limit, queryOpts);

    if (!data) {
      // Node missing from Neo4j — blocking sync then re-fetch
      await syncNode(type as GraphNodeType, id, orgId).catch((e) =>
        log.warn({ e, type, id }, "graph.node.sync.error")
      );
      data = await getNodeNeighborhood(type as GraphNodeType, id, depth, limit, queryOpts);
    } else if (isStale(data, id)) {
      // Node present but stale — background re-sync so response stays fast
      syncNode(type as GraphNodeType, id, orgId).catch((e) =>
        log.warn({ e, type, id }, "graph.node.background_sync.error")
      );
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, code: "NOT_FOUND", message: "Node not found in graph" },
        { status: 404 }
      );
    }

    log.info(
      { type, id, depth, limit, nodeCount: data.nodes.length },
      "graph.node.neighborhood"
    );

    return toResponse(ok(data));
  } catch (error) {
    log.error({ error, type, id }, "graph.node.route.error");
    return toResponse(err("INTERNAL", "Failed to fetch graph data"));
  }
}
