#!/usr/bin/env node
/**
 * Lightweight event emitter — used for SubagentStart, SubagentStop, and the
 * PostToolUse `mcp__notes-app__*` matcher. Writes one audit_log row per call
 * via /agent/sessions/:id/event; does NOT create a note_versions row.
 *
 * Why a separate script from checkpoint.js: checkpoints are coarse,
 * version-producing snapshots (commits, compact, session-end). These events
 * are fine-grained and high-frequency — keeping them in audit_log only
 * prevents history bloat while still giving us the "which subagent called
 * which tool when" trail.
 */
const { readStdin, loadSession, subagentContext, api } = require("./_lib");

function classify(input) {
  switch (input.hook_event_name) {
    case "SubagentStart":
      return "subagent.start";
    case "SubagentStop":
      return "subagent.stop";
    case "PostToolUse":
      // Only fire for MCP tool calls — narrow regardless of matcher in case
      // settings.json gets reused for a broader PostToolUse.
      if (typeof input.tool_name === "string" && input.tool_name.startsWith("mcp__")) {
        return "subagent.tool.call";
      }
      return null;
    default:
      return null;
  }
}

(async () => {
  const input = readStdin();
  const kind = classify(input);
  if (!kind) return;

  const sessionId = input.session_id || "default";
  const session = loadSession(sessionId);
  if (!session?.sessionNoteId) {
    process.stderr.write(`[event] no session note for ${sessionId}\n`);
    return;
  }

  const ctx = subagentContext(input);

  // For tool-call events without a subagent context, the call came from the
  // main agent — still worth recording, since the audit tells you "the main
  // agent called search_notes 17 times this session". We just record null
  // agent_id/agent_type.
  const detail = {};
  if (kind === "subagent.tool.call") {
    detail.toolName = input.tool_name;
    if (input.tool_response?.isError) detail.error = true;
    if (typeof input.duration_ms === "number") {
      detail.durationMs = input.duration_ms;
    }
  }

  try {
    await api(
      "POST",
      `/agent/sessions/${session.sessionNoteId}/event`,
      {
        kind,
        agentId: ctx.agentId,
        agentType: ctx.agentType,
        toolName: kind === "subagent.tool.call" ? input.tool_name : undefined,
        detail,
      },
    );
  } catch (err) {
    process.stderr.write(`[event] ${err.message}\n`);
  }
})();
