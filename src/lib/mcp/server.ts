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
        "Tools operate on a single org (bound to the MCP token). " +
        "READS: search_notes (full-text), list_recent_notes (recency), get_note (full content), " +
        "get_note_versions (history), list_tags (discover categories), " +
        "list_agent_sessions (multi-agent coordination), get_org_timeline (situational awareness). " +
        "WRITES: create_note, update_note (replace content), append_to_note (safe additive write). " +
        "Prefer append_to_note over update_note for shared notes. " +
        "Resources: notes://recent and notes://note/{noteId}.",
    },
  );

  registerTools(server, principal);
  registerResources(server, principal);

  return server;
}
