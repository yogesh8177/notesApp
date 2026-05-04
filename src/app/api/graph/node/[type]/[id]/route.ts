import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { ok, err, toResponse } from "@/lib/validation/result";
import { syncNode } from "@/lib/graph/sync";
import { getNodeNeighborhood } from "@/lib/graph/queries";
import { getDriver } from "@/lib/graph/client";
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
  orgId: z.string().uuid().optional(),
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

  const { depth, limit, orgId } = parsed.data;

  if (!getDriver()) {
    return NextResponse.json(
      { ok: false, code: "UPSTREAM", message: "Neo4j unavailable — graph feature requires NEO4J_URI" },
      { status: 503 }
    );
  }

  try {
    // Fire-and-forget sync — do not block the response on a Postgres+Neo4j round-trip
    if (orgId) {
      void syncNode(type as GraphNodeType, id, orgId);
    }

    const data = await getNodeNeighborhood(type as GraphNodeType, id, depth, limit);

    if (!data) {
      return NextResponse.json(
        { ok: false, code: "UPSTREAM", message: "Neo4j unavailable or node not found" },
        { status: 503 }
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
