import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Compact, deterministic JSON for tool/resource payloads.
 *
 * MCP clients show tool results to the model as text. JSON.stringify with
 * 2-space indent reads well in the model's context window without paying for
 * pretty-printer noise.
 */
export function jsonText(payload: unknown): string {
  return JSON.stringify(payload, (_, v) => (v instanceof Date ? v.toISOString() : v), 2);
}

export function textToolResult(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: jsonText(payload) }] };
}

export function errorToolResult(message: string, details?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: jsonText({ error: message, ...details }) }],
    isError: true,
  };
}

export function jsonResource(uri: string, payload: unknown): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: jsonText(payload),
      },
    ],
  };
}
