"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import type { GraphNodeType, GraphData, GraphNode } from "@/lib/graph/types";

interface GraphPreviewProps {
  nodeType: GraphNodeType;
  nodeId: string;
  orgId: string;
  children: React.ReactNode;
}

function groupNodes(nodes: GraphNode[], centerNodeId: string) {
  const others = nodes.filter((n) => n.id !== centerNodeId);
  const notes = others.filter((n) => n.type === "Note").slice(0, 5);
  const sessions = others.filter((n) => n.type === "AgentSession" || n.type === "ConversationTurn").slice(0, 3);
  const auditEvents = others.filter((n) => n.type === "AuditEvent").slice(0, 5);
  const people = others.filter((n) => n.type === "User").slice(0, 3);
  return { notes, sessions, auditEvents, people };
}

export function GraphPreview({ nodeType, nodeId, orgId, children }: GraphPreviewProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchedRef = useRef(false);

  const fetchPreview = useCallback(async () => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/graph/node/${nodeType}/${nodeId}?depth=1&limit=15&orgId=${orgId}`,
        { cache: "no-store" }
      );
      if (res.status === 503) {
        setUnavailable(true);
        return;
      }
      const payload = await res.json() as { ok: boolean; data?: GraphData };
      if (payload.ok && payload.data) {
        setData(payload.data);
      } else {
        setUnavailable(true);
      }
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [nodeType, nodeId, orgId]);

  function handleMouseEnter() {
    timerRef.current = setTimeout(() => {
      setOpen(true);
      void fetchPreview();
    }, 400);
  }

  function handleMouseLeave() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpen(false);
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const groups = data ? groupNodes(data.nodes, data.centerNodeId) : null;
  const hasContent = groups &&
    (groups.notes.length + groups.sessions.length + groups.auditEvents.length + groups.people.length) > 0;

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border bg-popover p-3 shadow-lg"
          onMouseEnter={() => {
            if (timerRef.current) clearTimeout(timerRef.current);
          }}
          onMouseLeave={handleMouseLeave}
        >
          {loading && (
            <div className="flex items-center gap-2 py-2">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              <span className="text-xs text-muted-foreground">Loading graph…</span>
            </div>
          )}

          {!loading && unavailable && (
            <p className="text-xs text-muted-foreground">No graph data available</p>
          )}

          {!loading && !unavailable && data && !hasContent && (
            <p className="text-xs text-muted-foreground">No connected nodes found</p>
          )}

          {!loading && !unavailable && hasContent && groups && (
            <div className="space-y-2">
              {groups.notes.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">Related Notes</p>
                  <ul className="space-y-0.5">
                    {groups.notes.map((n) => (
                      <li key={n.id}>
                        <Link
                          href={`/orgs/${orgId}/notes/${n.id}`}
                          className="block truncate text-xs text-foreground hover:underline"
                        >
                          {n.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {groups.sessions.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">Conversations</p>
                  <ul className="space-y-0.5">
                    {groups.sessions.map((n) => (
                      <li key={n.id} className="truncate text-xs text-muted-foreground">
                        {n.label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {groups.auditEvents.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">Audit Actions</p>
                  <ul className="space-y-0.5">
                    {groups.auditEvents.map((n) => (
                      <li key={n.id} className="truncate text-xs text-muted-foreground">
                        {String(n.properties.action ?? n.label)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {groups.people.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">People</p>
                  <ul className="space-y-0.5">
                    {groups.people.map((n) => (
                      <li key={n.id} className="truncate text-xs text-muted-foreground">
                        {n.label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="mt-2 border-t pt-2">
            <Link
              href={`/orgs/${orgId}/graph/${nodeType}/${nodeId}`}
              className="text-xs font-medium text-primary hover:underline"
            >
              View full graph →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
