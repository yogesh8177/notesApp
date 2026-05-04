"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphData, GraphNode } from "@/lib/graph/types";

// Dynamic import to avoid SSR issues with canvas APIs
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const NODE_COLORS: Record<string, string> = {
  Note: "#3b82f6",          // blue
  User: "#22c55e",          // green
  AgentSession: "#a855f7",  // purple
  ConversationTurn: "#f97316", // orange
  Tag: "#eab308",           // yellow
  AuditEvent: "#ef4444",    // red
};

const LEGEND_ITEMS = Object.entries(NODE_COLORS);

interface ForceNode {
  id: string;
  type: string;
  label: string;
  properties: Record<string, unknown>;
  x?: number;
  y?: number;
}

interface ForceLink {
  source: string | ForceNode;
  target: string | ForceNode;
  type: string;
}

// eslint-disable-next-line
type FGInstance = any;

interface GraphCanvasProps {
  data: GraphData;
  orgId: string;
  centerNodeId?: string;
  expandedNodeId?: string | null;
  newNodeIds?: Set<string>;
  onNodeClick?: (node: GraphNode) => void;
  onNodeDoubleClick?: (node: GraphNode) => void;
}

export function GraphCanvas({ data, orgId: _orgId, centerNodeId, expandedNodeId, newNodeIds, onNodeClick, onNodeDoubleClick }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<FGInstance>(null);
  const centeredRef = useRef(false);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  // Ref so the canvas paint callback always sees current highlighted IDs
  // without triggering a graphData reference change on every highlight update.
  const newNodeIdsRef = useRef<Set<string>>(newNodeIds ?? new Set());
  useEffect(() => { newNodeIdsRef.current = newNodeIds ?? new Set(); }, [newNodeIds]);
  const expandedNodeIdRef = useRef<string | null>(expandedNodeId ?? null);
  useEffect(() => { expandedNodeIdRef.current = expandedNodeId ?? null; }, [expandedNodeId]);

  // Reset centering when centerNodeId changes (new page load / explore-as-center)
  useEffect(() => { centeredRef.current = false; }, [centerNodeId]);

  useEffect(() => {
    function update() {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    }
    update();
    const observer = new ResizeObserver(update);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Memoised so ForceGraph2D only sees a new object when data actually changes,
  // not on every parent re-render (e.g. selectedNode, newNodeIds updates).
  const graphData = useMemo(() => ({
    nodes: data.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.label,
      properties: n.properties,
    })) as ForceNode[],
    links: data.links.map((l) => ({
      source: l.source,
      target: l.target,
      type: l.type,
    })) as ForceLink[],
  }), [data]);

  function toGraphNode(node: ForceNode): GraphNode {
    return { id: node.id, type: node.type as GraphNode["type"], label: node.label, properties: node.properties };
  }

  function handleNodeClick(node: ForceNode) {
    onNodeClick?.(toGraphNode(node));
  }

  function handleNodeDoubleClick(node: ForceNode) {
    onNodeDoubleClick?.(toGraphNode(node));
  }

  return (
    <div className="relative h-full w-full" ref={containerRef}>
      {/* Legend */}
      <div className="absolute right-3 top-3 z-10 rounded-lg border bg-background/90 p-2 text-xs shadow">
        <p className="mb-1 font-semibold text-muted-foreground">Node types</p>
        {LEGEND_ITEMS.map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5 py-0.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span>{type}</span>
          </div>
        ))}
      </div>

      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        width={dimensions.width}
        height={dimensions.height}
        nodeId="id"
        nodeLabel="label"
        nodeColor={(node) => NODE_COLORS[(node as ForceNode).type] ?? "#94a3b8"}
        nodeRelSize={6}
        linkLabel="type"
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        linkWidth={(link) => {
          const l = link as ForceLink;
          const srcId = typeof l.source === "string" ? l.source : (l.source as ForceNode).id;
          const tgtId = typeof l.target === "string" ? l.target : (l.target as ForceNode).id;
          return expandedNodeIdRef.current && (srcId === expandedNodeIdRef.current || tgtId === expandedNodeIdRef.current) ? 2.5 : 1;
        }}
        linkColor={(link) => {
          const l = link as ForceLink;
          const srcId = typeof l.source === "string" ? l.source : (l.source as ForceNode).id;
          const tgtId = typeof l.target === "string" ? l.target : (l.target as ForceNode).id;
          return expandedNodeIdRef.current && (srcId === expandedNodeIdRef.current || tgtId === expandedNodeIdRef.current)
            ? "#06b6d4"
            : "#94a3b8";
        }}
        onNodeClick={(node) => handleNodeClick(node as ForceNode)}
        onNodeRightClick={(node) => handleNodeDoubleClick(node as ForceNode)}
        onEngineStop={() => {
          if (centeredRef.current || !centerNodeId || !fgRef.current) return;
          centeredRef.current = true;
          // force-graph mutates node objects in-place with x/y as the sim runs,
          // so graphData.nodes already has current positions at engine stop.
          const target = graphData.nodes.find((n) => n.id === centerNodeId);
          if (target?.x != null && target?.y != null) {
            fgRef.current.centerAt(target.x, target.y, 600);
            fgRef.current.zoom(2.5, 600);
          }
        }}
        nodeCanvasObjectMode={() => "after"}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const n = node as ForceNode;
          const x = n.x ?? 0;
          const y = n.y ?? 0;

          // Persistent cyan ring on the node that was expanded
          if (expandedNodeIdRef.current === n.id) {
            ctx.beginPath();
            ctx.arc(x, y, 10, 0, 2 * Math.PI);
            ctx.strokeStyle = "#06b6d4";
            ctx.lineWidth = 2.5 / globalScale;
            ctx.stroke();
          }

          // Temporary yellow flash for newly discovered nodes
          if (newNodeIdsRef.current.has(n.id)) {
            ctx.beginPath();
            ctx.arc(x, y, 9, 0, 2 * Math.PI);
            ctx.strokeStyle = "#facc15";
            ctx.lineWidth = 2.5 / globalScale;
            ctx.stroke();
            // Outer glow
            ctx.beginPath();
            ctx.arc(x, y, 13, 0, 2 * Math.PI);
            ctx.strokeStyle = "rgba(250,204,21,0.3)";
            ctx.lineWidth = 4 / globalScale;
            ctx.stroke();
          }

          const label = n.label ?? n.id;
          const fontSize = Math.max(10 / globalScale, 2);
          ctx.font = `${fontSize}px sans-serif`;
          ctx.fillStyle = "#1e293b";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(label, x, y + 7);
        }}
      />
    </div>
  );
}
