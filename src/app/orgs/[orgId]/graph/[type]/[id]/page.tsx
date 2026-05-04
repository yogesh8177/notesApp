import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getDriver, ensureIndexes } from "@/lib/graph/client";
import { syncNode } from "@/lib/graph/sync";
import { getNodeNeighborhood, isStale } from "@/lib/graph/queries";
import type { GraphNodeType } from "@/lib/graph/types";
import { GraphPageClient } from "./graph-page-client";

const VALID_TYPES: GraphNodeType[] = [
  "Note",
  "User",
  "AgentSession",
  "ConversationTurn",
  "Tag",
  "AuditEvent",
];

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    Note: "Note",
    User: "User",
    AgentSession: "Agent Session",
    ConversationTurn: "Conversation Turn",
    Tag: "Tag",
    AuditEvent: "Audit Event",
  };
  return labels[type] ?? type;
}

export default async function GraphPage({
  params,
}: {
  params: Promise<{ orgId: string; type: string; id: string }>;
}) {
  const { orgId, type, id } = await params;
  await requireUser(`/orgs/${orgId}/graph/${type}/${id}`);
  void ensureIndexes();

  if (!VALID_TYPES.includes(type as GraphNodeType)) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/orgs/${orgId}/timeline`}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Link>
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Invalid node type</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Node type &ldquo;{type}&rdquo; is not valid.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!getDriver()) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/orgs/${orgId}/timeline`}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Graph Explorer</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Graph feature requires Neo4j</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              To enable the graph feature, set the following environment variables and restart the server:
            </p>
            <pre className="rounded-md bg-muted p-3 text-xs">
              {`NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-password`}
            </pre>
            <p className="text-sm text-muted-foreground">
              See the{" "}
              <a
                href="https://neo4j.com/docs/operations-manual/current/installation/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Neo4j installation guide
              </a>{" "}
              for setup instructions.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Fetch first; sync if missing or stale (blocking — this is SSR, data must be fresh)
  let initialData = await getNodeNeighborhood(type as GraphNodeType, id, 2, 50);
  if (!initialData || isStale(initialData, id)) {
    await syncNode(type as GraphNodeType, id, orgId).catch(() => null);
    initialData = await getNodeNeighborhood(type as GraphNodeType, id, 2, 50);
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col space-y-3">
      <div className="flex shrink-0 items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/orgs/${orgId}/timeline`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Graph Explorer</h1>
          <p className="text-xs text-muted-foreground">
            {typeLabel(type)} · {id.slice(0, 8)}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-hidden rounded-lg border">
        <GraphPageClient
          initialData={initialData}
          centerType={type as GraphNodeType}
          centerId={id}
          orgId={orgId}
        />
      </div>
    </div>
  );
}
