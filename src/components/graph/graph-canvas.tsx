"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
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

interface GraphCanvasProps {
  data: GraphData;
  orgId: string;
  onNodeClick?: (node: GraphNode) => void;
}

export function GraphCanvas({ data, orgId: _orgId, onNodeClick }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

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

  const graphData = {
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
  };

  function handleNodeClick(node: ForceNode) {
    if (onNodeClick) {
      onNodeClick({
        id: node.id,
        type: node.type as GraphNode["type"],
        label: node.label,
        properties: node.properties,
      });
    }
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
        onNodeClick={(node) => handleNodeClick(node as ForceNode)}
        nodeCanvasObjectMode={() => "after"}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const n = node as ForceNode;
          const label = n.label ?? n.id;
          const fontSize = Math.max(10 / globalScale, 2);
          ctx.font = `${fontSize}px sans-serif`;
          ctx.fillStyle = "#1e293b";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          const x = n.x ?? 0;
          const y = n.y ?? 0;
          ctx.fillText(label, x, y + 7);
        }}
      />
    </div>
  );
}
