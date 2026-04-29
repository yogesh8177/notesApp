import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentPrincipal } from "@/lib/agent";
import { registerResources } from "./resources";
import { registerTools } from "./tools";

const SERVER_NAME = "notes-app";
const SERVER_VERSION = "1.0.0";

/**
 * Build a fresh McpServer bound to the calling principal.
 *
 * Stateless mode: one server per HTTP request, lives only for that request's
 * lifetime. Tools and resources close over the principal so every call is
 * scoped to (orgId, userId) without per-call argument-passing.
 */
export function createMcpServer(principal: AgentPrincipal): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
      },
      instructions:
        "Tools and resources operate on a single org's notes (the org bound " +
        "to the MCP token). Use search_notes for content queries, " +
        "list_recent_notes for recency views, get_note for full content. " +
        "Resources are at notes://recent and notes://note/{noteId}.",
    },
  );

  registerTools(server, principal);
  registerResources(server, principal);

  return server;
}
