import neo4j from "neo4j-driver";
import { log } from "@/lib/log";
import { getDriver } from "./client";
import type { GraphData, GraphNode, GraphLink, GraphNodeType } from "./types";

export const SYNC_TTL_MS = 30 * 60 * 1000; // 30 minutes — queue handles mutation sync; TTL is belt-and-suspenders

function toGraphNodeType(label: string): GraphNodeType {
  const valid: GraphNodeType[] = ["Note", "User", "AgentSession", "ConversationTurn", "Tag", "AuditEvent"];
  return valid.includes(label as GraphNodeType) ? (label as GraphNodeType) : "Note";
}

function nodeLabel(type: GraphNodeType, props: Record<string, unknown>): string {
  switch (type) {
    case "Note":             return (props.title as string) || "Note";
    case "User":             return (props.displayName as string) || (props.email as string) || "User";
    case "AgentSession":     return `Session ${(props.branch as string) || ""}`.trim();
    case "ConversationTurn": return `Turn ${props.turnIndex ?? ""}`.trim();
    case "Tag":              return `#${props.name ?? "tag"}`;
    case "AuditEvent":       return (props.action as string) || "Event";
    default:                 return type;
  }
}

export interface NeighborhoodOptions {
  depth?: number;
  limit?: number;
  orgId?: string; // when provided, center node and all traversed neighbors are filtered to this org
  from?: string; // ISO date string, inclusive
  to?: string;   // ISO date string, inclusive
}

/**
 * True when the center node has no syncedAt or it is older than SYNC_TTL_MS.
 * Nodes synced before syncedAt was introduced have no property → treated as stale.
 */
export function isStale(data: GraphData, id: string): boolean {
  const center = data.nodes.find((n) => n.id === id);
  const raw = center?.properties.syncedAt as string | undefined;
  if (!raw) return true;
  return Date.now() - new Date(raw).getTime() > SYNC_TTL_MS;
}

/** Build a Cypher WHERE clause and params for org + date filtering on neighbor. */
function buildNeighborWhere(
  orgId?: string,
  from?: string,
  to?: string,
): { clause: string; params: Record<string, string | null> } {
  const conditions: string[] = [];
  const params: Record<string, string | null> = {};

  if (orgId) {
    // User nodes are cross-org — exempt them so multi-org membership doesn't hide authors/actors.
    conditions.push("('User' IN labels(neighbor) OR neighbor.orgId = $orgId)");
    params.orgId = orgId;
  }
  if (from) { conditions.push("(neighbor.createdAt IS NULL OR neighbor.createdAt >= $dateFrom)"); params.dateFrom = from; }
  if (to)   { conditions.push("(neighbor.createdAt IS NULL OR neighbor.createdAt <= $dateTo)");   params.dateTo   = to;   }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

/**
 * Query Neo4j for neighborhood of a node up to `depth` hops, collecting
 * up to `limit` nodes. Returns null if Neo4j is unavailable or node not found.
 */
export async function getNodeNeighborhood(
  type: GraphNodeType,
  id: string,
  depth: number = 2,
  limit: number = 50,
  opts: NeighborhoodOptions = {}
): Promise<GraphData | null> {
  const driver = getDriver();
  if (!driver) return null;

  const { orgId, from, to } = opts;
  const session = driver.session();
  try {
    // APOC path: enforce orgId on center node so cross-org IDs return nothing.
    const centerFilter = orgId ? `{id: $id, orgId: $orgId}` : `{id: $id}`;
    const apocParams: Record<string, unknown> = { id, depth: neo4j.int(depth), limit: neo4j.int(limit) };
    if (orgId) apocParams.orgId = orgId;

    const result = await session.run(
      `MATCH (center:${type} ${centerFilter})
       CALL apoc.path.subgraphAll(center, {maxLevel: $depth, limit: $limit}) YIELD nodes, relationships
       RETURN nodes, relationships`,
      apocParams
    );

    if (result.records.length > 0) {
      const data = buildGraphData(result.records[0].get("nodes"), result.records[0].get("relationships"), id);
      // APOC doesn't support inline property filtering — apply org + date in JS.
      return applyFilters(data, orgId, from, to);
    }

    return await fallbackNeighborhood(session, type, id, depth, limit, opts);
  } catch (err) {
    log.debug({ err }, "graph.apoc_unavailable_using_fallback");
    try {
      return await fallbackNeighborhood(session, type, id, depth, limit, opts);
    } catch (fallbackErr) {
      log.error({ err: fallbackErr, type, id }, "graph.query.error");
      return null;
    }
  } finally {
    await session.close();
  }
}

/** JS-side org + date filter — used only for the APOC path (which can't filter inline). */
function applyFilters(data: GraphData, orgId?: string, from?: string, to?: string): GraphData {
  if (!orgId && !from && !to) return data;
  const fromTs = from ? new Date(from).getTime() : -Infinity;
  const toTs   = to   ? new Date(to).getTime()   :  Infinity;

  const keepIds = new Set<string>();
  keepIds.add(data.centerNodeId); // center is already org-scoped by the MATCH clause
  for (const node of data.nodes) {
    if (node.id === data.centerNodeId) continue;
    // Org filter: User nodes are cross-org, pass through. All others must match.
    if (orgId && node.type !== "User") {
      const nodeOrg = node.properties.orgId as string | undefined;
      if (nodeOrg && nodeOrg !== orgId) continue;
    }
    // Date filter: nodes without createdAt always pass.
    const raw = node.properties.createdAt as string | undefined;
    if (raw) {
      const ts = new Date(raw).getTime();
      if (ts < fromTs || ts > toTs) continue;
    }
    keepIds.add(node.id);
  }

  return {
    ...data,
    nodes: data.nodes.filter((n) => keepIds.has(n.id)),
    links: data.links.filter((l) => keepIds.has(l.source) && keepIds.has(l.target)),
  };
}

async function fallbackNeighborhood(
  session: ReturnType<NonNullable<ReturnType<typeof getDriver>>["session"]>,
  type: GraphNodeType,
  id: string,
  depth: number,
  limit: number,
  opts: NeighborhoodOptions = {}
): Promise<GraphData | null> {
  const safeDepth = Math.min(depth, 4);
  const { orgId, from, to } = opts;
  // Org + date filters pushed into Cypher so we don't over-fetch and discard in JS.
  const { clause: neighborWhere, params: neighborParams } = buildNeighborWhere(orgId, from, to);
  const centerFilter = orgId ? `{id: $id, orgId: $orgId}` : `{id: $id}`;
  const centerParams: Record<string, unknown> = orgId ? { id, orgId } : { id };

  const result = await session.run(
    `MATCH (center:${type} ${centerFilter})
     OPTIONAL MATCH path = (center)-[*1..${safeDepth}]-(neighbor)
     ${neighborWhere}
     WITH center, neighbor, path LIMIT $limit
     WITH center, collect(DISTINCT neighbor) AS neighbors,
          collect(DISTINCT relationships(path)) AS relPaths
     UNWIND [center] + neighbors AS n
     WITH collect(DISTINCT n) AS allNodes, relPaths
     UNWIND relPaths AS rels
     UNWIND rels AS r
     RETURN allNodes AS nodes, collect(DISTINCT r) AS relationships`,
    { ...centerParams, limit: neo4j.int(limit), ...neighborParams }
  );

  if (result.records.length === 0) {
    // No paths — try to return just the center node (org-scoped).
    const centerResult = await session.run(
      `MATCH (n:${type} ${centerFilter}) RETURN n`,
      centerParams
    );
    if (centerResult.records.length === 0) return null;
    const node = centerResult.records[0].get("n");
    const labels: string[] = node.labels ?? [];
    const nodeType = toGraphNodeType(labels[0] ?? "Note");
    const props = node.properties as Record<string, unknown>;
    return {
      nodes: [{ id: String(props.id ?? id), type: nodeType, label: nodeLabel(nodeType, props), properties: props }],
      links: [],
      centerNodeId: id,
    };
  }

  const record = result.records[0];
  // Org + date already filtered in Cypher — no JS post-filter needed here.
  return buildGraphData(record.get("nodes"), record.get("relationships"), id);
}

function buildGraphData(
  rawNodes: unknown[],
  rawRels: unknown[],
  centerNodeId: string
): GraphData {
  const nodes: GraphNode[] = [];
  const seenNodeIds = new Set<string>();
  // neo4j-driver v5: rels only carry element IDs (internal), not app IDs.
  // Build a lookup to resolve them back to our string IDs.
  const elementIdToAppId = new Map<string, string>();

  for (const n of rawNodes) {
    const node = n as { labels: string[]; properties: Record<string, unknown>; elementId?: string };
    const props = node.properties;
    const nodeId = String(props.id ?? "");
    if (!nodeId || seenNodeIds.has(nodeId)) continue;
    seenNodeIds.add(nodeId);
    if (node.elementId) elementIdToAppId.set(node.elementId, nodeId);
    const nodeType = toGraphNodeType(node.labels?.[0] ?? "Note");
    nodes.push({ id: nodeId, type: nodeType, label: nodeLabel(nodeType, props), properties: props });
  }

  const links: GraphLink[] = [];
  const seenLinkIds = new Set<string>();

  for (const r of rawRels) {
    const rel = r as {
      type: string;
      properties: Record<string, unknown>;
      startNodeElementId?: string;
      endNodeElementId?: string;
    };
    const sourceId = rel.startNodeElementId ? (elementIdToAppId.get(rel.startNodeElementId) ?? null) : null;
    const targetId = rel.endNodeElementId   ? (elementIdToAppId.get(rel.endNodeElementId)   ?? null) : null;
    if (!sourceId || !targetId) continue;
    const linkKey = `${sourceId}→${rel.type}→${targetId}`;
    if (seenLinkIds.has(linkKey)) continue;
    seenLinkIds.add(linkKey);
    links.push({ source: sourceId, target: targetId, type: rel.type, properties: rel.properties });
  }

  return { nodes, links, centerNodeId };
}

/** Shallow preview — depth=1, limit=15, for hover popover. */
export async function getNodePreview(
  type: GraphNodeType,
  id: string,
  orgId?: string
): Promise<GraphData | null> {
  return getNodeNeighborhood(type, id, 1, 15, orgId ? { orgId } : {});
}

export interface GraphHotspot {
  id: string;
  title: string;
  refCount: number;
}

/**
 * Top notes by agent reference count across the org.
 * Used at bootstrap to inject "knowledge hotspots" — notes agents rely on most.
 * Returns [] gracefully when Neo4j is unavailable.
 */
export async function getBootstrapGraphContext(orgId: string): Promise<GraphHotspot[]> {
  const driver = getDriver();
  if (!driver) return [];

  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (ct:ConversationTurn {orgId: $orgId})-[:REFERENCES]->(n:Note {orgId: $orgId})
       WITH n, count(ct) AS refCount
       WHERE refCount >= $minRefs
       RETURN n.id AS id, n.title AS title, refCount
       ORDER BY refCount DESC LIMIT 5`,
      { orgId, minRefs: neo4j.int(3) },
    );
    return result.records.map((r) => ({
      id: r.get("id") as string,
      title: r.get("title") as string,
      refCount: Number(r.get("refCount")),
    }));
  } catch (err) {
    log.warn({ err, orgId }, "graph.bootstrap.context.failed");
    return [];
  } finally {
    await session.close();
  }
}
