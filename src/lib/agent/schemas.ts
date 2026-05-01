import { z } from "zod";

/** Identity of the calling agent's session. */
const identifier = z.string().trim().min(1).max(200);

export const bootstrapSchema = z.object({
  repo: identifier,
  branch: identifier,
  agentId: identifier,
  /** SessionStart matcher value: startup | resume | clear | compact */
  source: z.enum(["startup", "resume", "clear", "compact"]).optional(),
  repoUrl: z.string().url().max(500).optional(),
});
export type BootstrapInput = z.infer<typeof bootstrapSchema>;

export const checkpointSchema = z.object({
  /** Hook event that produced this checkpoint. */
  event: z.enum(["commit", "compact", "stop"]),
  repo: identifier,
  branch: identifier,
  agentId: identifier,
  lastCommit: z.string().trim().max(64).optional().default(""),
  body: z.string().trim().max(5000).optional().default(""),
  done: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  next: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  issues: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  decisions: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  repoUrl: z.string().url().max(500).optional(),
});
export type CheckpointInput = z.infer<typeof checkpointSchema>;

/**
 * Per-event audit emission for subagent activity. Lightweight: produces an
 * audit_log row but no note_versions row, so high-frequency events (every
 * MCP tool call by a subagent) don't bloat session note history.
 */
export const agentEventSchema = z.object({
  kind: z.enum(["subagent.start", "subagent.stop", "subagent.tool.call"]),
  agentId: z.string().trim().max(200).nullable().optional(),
  agentType: z.string().trim().max(80).nullable().optional(),
  toolName: z.string().trim().max(200).optional(),
  detail: z.record(z.unknown()).optional(),
});
export type AgentEventInput = z.infer<typeof agentEventSchema>;
