import { log } from "@/lib/log";
import { getDriver } from "./client";
import type { GraphData, GraphNode, GraphLink, GraphNodeType } from "./types";

function toGraphNodeType(label: string): GraphNodeType {
  const valid: GraphNodeType[] = ["Note", "User", "AgentSession", "ConversationTurn", "Tag", "AuditEvent"];
  return valid.includes(label as GraphNodeType) ? (label as GraphNodeType) : "Note";
}

function nodeLabel(type: GraphNodeType, props: Record<string, unknown>): string {
  switch (type) {
    case "Note":
      return (props.title as string) || "Note";
    case "User":
      return (props.displayName as string) || (props.email as string) || "User";
    case "AgentSession":
      return `Session ${(props.branch as string) || ""}`.trim();
    case "ConversationTurn":
      return `Turn ${props.turnIndex ?? ""}`.trim();
    case "Tag":
      return `#${props.name ?? "tag"}`;
    case "AuditEvent":
      return (props.action as string) || "Event";
    default:
      return type;
  }
}

/**
 * Query Neo4j for neighborhood of a node up to `depth` hops, collecting
 * up to `limit` nodes. Returns null if Neo4j is unavailable.
 */
export async function getNodeNeighborhood(
  type: GraphNodeType,
  id: string,
  depth: number = 2,
  limit: number = 50
): Promise<GraphData | null> {
  const driver = getDriver();
  if (!driver) return null;

  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (center {id: $id})
       CALL apoc.path.subgraphAll(center, {maxLevel: $depth, limit: $limit}) YIELD nodes, relationships
       RETURN nodes, relationships`,
      { id, depth, limit }
    );

    if (result.records.length > 0) {
      return buildGraphData(result.records[0].get("nodes"), result.records[0].get("relationships"), id);
    }

    // Fallback without APOC
    return await fallbackNeighborhood(session, type, id, depth, limit);
  } catch (err) {
    // APOC not available — use manual expansion
    log.debug({ err }, "graph.apoc_unavailable_using_fallback");
    try {
      return await fallbackNeighborhood(session, type, id, depth, limit);
    } catch (fallbackErr) {
      log.error({ err: fallbackErr, type, id }, "graph.query.error");
      return null;
    }
  } finally {
    await session.close();
  }
}

async function fallbackNeighborhood(
  session: ReturnType<NonNullable<ReturnType<typeof getDriver>>["session"]>,
  _type: GraphNodeType,
  id: string,
  depth: number,
  limit: number
): Promise<GraphData | null> {
  // Build a variable-depth pattern manually up to depth 4
  const safeDepth = Math.min(depth, 4);
  const result = await session.run(
    `MATCH (center {id: $id})
     OPTIONAL MATCH path = (center)-[*1..${safeDepth}]-(neighbor)
     WITH center, collect(DISTINCT neighbor)[0..$limit] AS neighbors,
          collect(DISTINCT relationships(path)) AS relPaths
     UNWIND [center] + neighbors AS n
     WITH collect(DISTINCT n) AS allNodes, relPaths
     UNWIND relPaths AS rels
     UNWIND rels AS r
     RETURN allNodes AS nodes, collect(DISTINCT r) AS relationships`,
    { id, limit }
  );

  if (result.records.length === 0) {
    // Just the center node
    const centerResult = await session.run(
      `MATCH (n {id: $id}) RETURN n`,
      { id }
    );
    if (centerResult.records.length === 0) return null;
    const node = centerResult.records[0].get("n");
    const labels: string[] = node.labels ?? [];
    const nodeType = toGraphNodeType(labels[0] ?? "Note");
    const props = node.properties as Record<string, unknown>;
    return {
      nodes: [{
        id: String(props.id ?? id),
        type: nodeType,
        label: nodeLabel(nodeType, props),
        properties: props,
      }],
      links: [],
      centerNodeId: id,
    };
  }

  const record = result.records[0];
  return buildGraphData(record.get("nodes"), record.get("relationships"), id);
}

function buildGraphData(
  rawNodes: unknown[],
  rawRels: unknown[],
  centerNodeId: string
): GraphData {
  const nodes: GraphNode[] = [];
  const seenNodeIds = new Set<string>();
  // neo4j-driver v5: relationships only carry startNodeElementId/endNodeElementId
  // (internal Neo4j IDs), not embedded node properties. Build a lookup so we can
  // resolve those back to our application-level string IDs.
  const elementIdToAppId = new Map<string, string>();

  for (const n of rawNodes) {
    const node = n as { labels: string[]; properties: Record<string, unknown>; elementId?: string };
    const props = node.properties;
    const nodeId = String(props.id ?? "");
    if (!nodeId || seenNodeIds.has(nodeId)) continue;
    seenNodeIds.add(nodeId);
    if (node.elementId) elementIdToAppId.set(node.elementId, nodeId);
    const nodeType = toGraphNodeType(node.labels?.[0] ?? "Note");
    nodes.push({
      id: nodeId,
      type: nodeType,
      label: nodeLabel(nodeType, props),
      properties: props,
    });
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

    const sourceId = rel.startNodeElementId
      ? (elementIdToAppId.get(rel.startNodeElementId) ?? null)
      : null;
    const targetId = rel.endNodeElementId
      ? (elementIdToAppId.get(rel.endNodeElementId) ?? null)
      : null;

    if (!sourceId || !targetId) continue;
    const linkKey = `${sourceId}→${rel.type}→${targetId}`;
    if (seenLinkIds.has(linkKey)) continue;
    seenLinkIds.add(linkKey);

    links.push({
      source: sourceId,
      target: targetId,
      type: rel.type,
      properties: rel.properties,
    });
  }

  return { nodes, links, centerNodeId };
}

/**
 * Shallow preview — depth=1, limit=15, for hover popover.
 */
export async function getNodePreview(
  type: GraphNodeType,
  id: string
): Promise<GraphData | null> {
  return getNodeNeighborhood(type, id, 1, 15);
}
