"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { GraphCanvas } from "@/components/graph/graph-canvas";
import type { GraphData, GraphNode, GraphNodeType } from "@/lib/graph/types";

interface GraphPageClientProps {
  initialData: GraphData | null;
  centerType: GraphNodeType;
  centerId: string;
  orgId: string;
}

function mergeGraphData(existing: GraphData, incoming: GraphData): GraphData {
  const nodeMap = new Map(existing.nodes.map((n) => [n.id, n]));
  for (const n of incoming.nodes) {
    nodeMap.set(n.id, n);
  }

  const linkSet = new Set(existing.links.map((l) => `${l.source}→${l.type}→${l.target}`));
  const allLinks = [...existing.links];
  for (const l of incoming.links) {
    const key = `${l.source}→${l.type}→${l.target}`;
    if (!linkSet.has(key)) {
      linkSet.add(key);
      allLinks.push(l);
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    links: allLinks,
    centerNodeId: existing.centerNodeId,
  };
}

function NodeProperties({ node }: { node: GraphNode }) {
  const skip = new Set(["id", "orgId"]);
  const entries = Object.entries(node.properties).filter(([k]) => !skip.has(k));

  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{node.type}</span>
        <span className="font-semibold">{node.label}</span>
      </div>
      <div className="mt-2 space-y-1">
        {entries.map(([k, v]) => (
          <div key={k} className="flex gap-1">
            <span className="min-w-24 shrink-0 text-muted-foreground">{k}</span>
            <span className="truncate text-foreground" title={String(v)}>
              {String(v).slice(0, 60)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GraphPageClient({
  initialData,
  centerType,
  centerId,
  orgId,
}: GraphPageClientProps) {
  const router = useRouter();
  const [graphData, setGraphData] = useState<GraphData | null>(initialData);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [depth, setDepth] = useState(2);
  const [loading, setLoading] = useState(false);

  const expandNode = useCallback(
    async (node: GraphNode) => {
      setSelectedNode(node);
      setLoading(true);
      try {
        const res = await fetch(
          `/api/graph/node/${node.type}/${node.id}?depth=${depth}&limit=50&orgId=${orgId}`,
          { cache: "no-store" }
        );
        const payload = (await res.json()) as { ok: boolean; data?: GraphData };
        if (payload.ok && payload.data && graphData) {
          setGraphData(mergeGraphData(graphData, payload.data));
        }
      } catch {
        // silently ignore expansion failures
      } finally {
        setLoading(false);
      }
    },
    [depth, orgId, graphData]
  );

  function handleNodeClick(node: GraphNode) {
    setSelectedNode(node);
    void expandNode(node);
  }

  async function handleDepthChange(newDepth: number) {
    setDepth(newDepth);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/graph/node/${centerType}/${centerId}?depth=${newDepth}&limit=50&orgId=${orgId}`,
        { cache: "no-store" }
      );
      const payload = (await res.json()) as { ok: boolean; data?: GraphData };
      if (payload.ok && payload.data) {
        setGraphData(payload.data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  if (!graphData) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">No graph data found for this node.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Main canvas */}
      <div className="relative flex-1">
        {loading && (
          <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-md border bg-background/90 px-2 py-1 text-xs shadow">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            Loading…
          </div>
        )}

        {/* Depth slider */}
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-md border bg-background/90 px-3 py-1.5 shadow">
          <label className="text-xs font-medium text-muted-foreground">Depth</label>
          <input
            type="range"
            min={1}
            max={4}
            value={depth}
            onChange={(e) => void handleDepthChange(Number(e.target.value))}
            className="h-1 w-20 accent-primary"
          />
          <span className="w-4 text-center text-xs font-medium">{depth}</span>
        </div>

        <GraphCanvas
          data={graphData}
          orgId={orgId}
          onNodeClick={handleNodeClick}
        />
      </div>

      {/* Side panel */}
      <div className="w-64 shrink-0 overflow-y-auto border-l p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Node Details
        </p>
        {selectedNode ? (
          <div className="space-y-3">
            <NodeProperties node={selectedNode} />
            <button
              onClick={() => router.push(`/orgs/${orgId}/graph/${selectedNode.type}/${selectedNode.id}`)}
              className="w-full rounded-md border bg-muted px-2 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80"
            >
              Explore this node →
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Click a node to see details.</p>
        )}

        <div className="mt-4 border-t pt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Summary
          </p>
          <p className="text-xs text-muted-foreground">
            {graphData.nodes.length} nodes · {graphData.links.length} edges
          </p>
        </div>
      </div>
    </div>
  );
}
