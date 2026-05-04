"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
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
  for (const n of incoming.nodes) nodeMap.set(n.id, n);

  const linkSet = new Set(existing.links.map((l) => `${l.source}→${l.type}→${l.target}`));
  const allLinks = [...existing.links];
  for (const l of incoming.links) {
    const key = `${l.source}→${l.type}→${l.target}`;
    if (!linkSet.has(key)) { linkSet.add(key); allLinks.push(l); }
  }
  return { nodes: Array.from(nodeMap.values()), links: allLinks, centerNodeId: existing.centerNodeId };
}

function formatTs(val: unknown): string {
  if (!val) return "—";
  try { return new Date(String(val)).toLocaleString(); } catch { return String(val); }
}

function NodeDetails({ node, orgId, onExpand, expanding }: {
  node: GraphNode;
  orgId: string;
  onExpand: () => void;
  expanding: boolean;
}) {
  const router = useRouter();
  const p = node.properties;

  const typeColor: Record<string, string> = {
    Note: "bg-blue-100 text-blue-800",
    User: "bg-green-100 text-green-800",
    AgentSession: "bg-purple-100 text-purple-800",
    ConversationTurn: "bg-orange-100 text-orange-800",
    Tag: "bg-yellow-100 text-yellow-800",
    AuditEvent: "bg-red-100 text-red-800",
  };

  return (
    <div className="space-y-3 text-xs">
      {/* Header */}
      <div className="space-y-1">
        <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${typeColor[node.type] ?? "bg-muted text-foreground"}`}>
          {node.type}
        </span>
        <p className="font-semibold leading-snug">{node.label}</p>
      </div>

      {/* Type-specific content */}
      {node.type === "Note" && (
        <div className="space-y-1.5">
          <Row label="Visibility" value={String(p.visibility ?? "—")} />
          <Row label="Version" value={`v${p.currentVersion ?? "?"}`} />
          <Row label="Updated" value={formatTs(p.updatedAt)} />
          <Row label="Created" value={formatTs(p.createdAt)} />
          <NavLink href={`/orgs/${orgId}/notes/${node.id}`}>Open note →</NavLink>
          <NavLink href={`/orgs/${orgId}/notes/${node.id}/history`}>
            Version history (v{String(p.currentVersion ?? "?")}) →
          </NavLink>
          <NavLink href={`/orgs/${orgId}/notes/${node.id}/timeline`}>Note timeline →</NavLink>
        </div>
      )}

      {node.type === "User" && (
        <div className="space-y-1.5">
          <Row label="Email" value={String(p.email ?? "—")} />
          <Row label="Name" value={String(p.displayName || "—")} />
        </div>
      )}

      {node.type === "AgentSession" && (
        <div className="space-y-1.5">
          <Row label="Repo" value={String(p.repo ?? "—")} />
          <Row label="Branch" value={String(p.branch ?? "—")} />
          <Row label="Created" value={formatTs(p.createdAt)} />
          {!!p.noteId && (<>
            <NavLink href={`/orgs/${orgId}/notes/${String(p.noteId)}/conversation`}>
              View conversation →
            </NavLink>
            <NavLink href={`/orgs/${orgId}/notes/${String(p.noteId)}/dashboard`}>
              Tool call dashboard →
            </NavLink>
          </>)}
        </div>
      )}

      {node.type === "ConversationTurn" && (
        <div className="space-y-1.5">
          <Row label="Role" value={String(p.role ?? "—")} />
          <Row label="Turn" value={`#${p.turnIndex ?? "?"}`} />
          <Row label="Created" value={formatTs(p.createdAt)} />
          {!!p.contentPreview && (
            <div>
              <p className="mb-0.5 text-muted-foreground">Preview</p>
              <p className="rounded bg-muted p-1.5 text-[11px] leading-relaxed line-clamp-4">
                {String(p.contentPreview)}
              </p>
            </div>
          )}
          {!!p.sessionNoteId && (
            <NavLink href={`/orgs/${orgId}/notes/${String(p.sessionNoteId)}/conversation#turn-${String(p.turnIndex ?? "")}`}>
              Jump to turn #{String(p.turnIndex ?? "?")} →
            </NavLink>
          )}
        </div>
      )}

      {node.type === "AuditEvent" && (() => {
        const action = String(p.action ?? "");
        const resId = p.resourceId ? String(p.resourceId) : null;
        const isNoteMutation = action.startsWith("note.");
        const isToolCall = action.includes("tool") || action.includes("agent.event");
        const isNoteResource = p.resourceType === "note" && resId;
        return (
          <div className="space-y-1.5">
            <Row label="Action" value={action || "—"} />
            <Row label="Resource" value={String(p.resourceType ?? "—")} />
            <Row label="When" value={formatTs(p.createdAt)} />
            {isNoteResource && (
              <NavLink href={`/orgs/${orgId}/notes/${resId}`}>Open note →</NavLink>
            )}
            {isNoteResource && isNoteMutation && (
              <NavLink href={`/orgs/${orgId}/notes/${resId}/history`}>
                Note version history →
              </NavLink>
            )}
            {isNoteResource && isToolCall && (
              <NavLink href={`/orgs/${orgId}/notes/${resId}/dashboard`}>
                Tool call dashboard →
              </NavLink>
            )}
            {isNoteResource && (
              <NavLink href={`/orgs/${orgId}/notes/${resId}/timeline`}>
                Note timeline →
              </NavLink>
            )}
            <NavLink href={`/orgs/${orgId}/timeline`}>Org timeline →</NavLink>
          </div>
        );
      })()}

      {node.type === "Tag" && (
        <div className="space-y-1.5">
          <Row label="Name" value={`#${String(p.name ?? node.label)}`} />
        </div>
      )}

      {/* Expand + navigate actions */}
      <div className="space-y-1.5 border-t pt-2">
        <button
          onClick={onExpand}
          disabled={expanding}
          className="w-full rounded-md border bg-primary px-2 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {expanding ? "Expanding…" : "Expand neighbors"}
        </button>
        <button
          onClick={() => router.push(`/orgs/${orgId}/graph/${node.type}/${node.id}`)}
          className="w-full rounded-md border bg-muted px-2 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted/80"
        >
          Explore as center →
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <span className="min-w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-foreground" title={value}>{value}</span>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block text-primary hover:underline">
      {children}
    </Link>
  );
}

export function GraphPageClient({ initialData, centerType, centerId, orgId }: GraphPageClientProps) {
  const [graphData, setGraphData] = useState<GraphData | null>(initialData);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [depth, setDepth] = useState(2);
  const [loading, setLoading] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [newNodeIds, setNewNodeIds] = useState<Set<string>>(new Set());
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);

  const expandNode = useCallback(async (node: GraphNode) => {
    setExpanding(true);
    setExpandedNodeId(node.id);
    try {
      const res = await fetch(
        `/api/graph/node/${node.type}/${node.id}?depth=${depth}&limit=50&orgId=${orgId}`,
        { cache: "no-store" }
      );
      const payload = (await res.json()) as { ok: boolean; data?: GraphData };
      if (payload.ok && payload.data) {
        setGraphData((prev) => {
          const merged = prev ? mergeGraphData(prev, payload.data!) : payload.data!;
          const existingIds = new Set(prev?.nodes.map((n) => n.id) ?? []);
          const fresh = new Set(merged.nodes.filter((n) => !existingIds.has(n.id)).map((n) => n.id));
          if (fresh.size > 0) {
            setNewNodeIds(fresh);
            setTimeout(() => setNewNodeIds(new Set()), 2500);
          }
          return merged;
        });
      }
    } catch { /* ignore */ } finally {
      setExpanding(false);
    }
  }, [depth, orgId]);

  // Single click → select + show details only
  function handleNodeClick(node: GraphNode) {
    setSelectedNode(node);
  }

  // Right-click → expand neighbors inline
  function handleNodeDoubleClick(node: GraphNode) {
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
      if (payload.ok && payload.data) setGraphData(payload.data);
    } catch { /* ignore */ } finally {
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
      {/* Canvas */}
      <div className="relative flex-1">
        {loading && (
          <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-md border bg-background/90 px-2 py-1 text-xs shadow">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            Loading…
          </div>
        )}

        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-md border bg-background/90 px-3 py-1.5 shadow">
          <label className="text-xs font-medium text-muted-foreground">Depth</label>
          <input
            type="range" min={1} max={4} value={depth}
            onChange={(e) => void handleDepthChange(Number(e.target.value))}
            className="h-1 w-20 accent-primary"
          />
          <span className="w-4 text-center text-xs font-medium">{depth}</span>
        </div>

        <div className="absolute bottom-3 right-3 z-10 rounded-md border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow">
          Click to select · Right-click to expand
        </div>

        <GraphCanvas
          data={graphData}
          orgId={orgId}
          centerNodeId={graphData.centerNodeId}
          expandedNodeId={expandedNodeId}
          newNodeIds={newNodeIds}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
        />
      </div>

      {/* Side panel */}
      <div className="w-64 shrink-0 overflow-y-auto border-l p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Node Details
        </p>

        {selectedNode ? (
          <NodeDetails
            node={selectedNode}
            orgId={orgId}
            onExpand={() => void expandNode(selectedNode)}
            expanding={expanding}
          />
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
