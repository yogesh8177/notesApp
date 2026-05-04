export type GraphNodeType =
  | "Note"
  | "User"
  | "AgentSession"
  | "ConversationTurn"
  | "Tag"
  | "AuditEvent";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  properties: Record<string, unknown>;
}

export interface GraphLink {
  source: string;
  target: string;
  type: string;
  properties?: Record<string, unknown>;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  centerNodeId: string;
}
