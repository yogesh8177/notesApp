import { z } from "zod";

/** Identity of the calling agent's session. */
const identifier = z.string().trim().min(1).max(200);

export const bootstrapSchema = z.object({
  repo: identifier,
  branch: identifier,
  agentId: identifier,
  /** SessionStart matcher value: startup | resume | clear | compact */
  source: z.enum(["startup", "resume", "clear", "compact"]).optional(),
});
export type BootstrapInput = z.infer<typeof bootstrapSchema>;

export const checkpointSchema = z.object({
  /** Hook event that produced this checkpoint. */
  event: z.enum(["commit", "compact", "stop"]),
  repo: identifier,
  branch: identifier,
  agentId: identifier,
  lastCommit: z.string().trim().max(64).optional().default(""),
  done: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  next: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  issues: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  decisions: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
});
export type CheckpointInput = z.infer<typeof checkpointSchema>;
