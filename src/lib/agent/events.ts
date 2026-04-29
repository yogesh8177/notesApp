import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { notes } from "@/lib/db/schema";
import { audit } from "@/lib/log/audit";
import { log } from "@/lib/log";
import type { AgentPrincipal } from "./auth";
import type { AgentEventInput } from "./schemas";

/**
 * Lightweight per-event audit logger for high-frequency hook activity that
 * doesn't deserve a `note_versions` row.
 *
 * Used for: subagent lifecycle (`SubagentStart` / `SubagentStop`), MCP-tool
 * invocations made by subagents, and other observability-only signals. The
 * session note's content remains the running state; this endpoint feeds
 * `audit_log` only, where high write volume is expected.
 *
 * Verifies that the session note belongs to the principal's org before
 * writing — same defence as `checkpoint()`.
 */
export type EventOutcome =
  | { ok: true }
  | { ok: false; error: "NOT_FOUND" | "FORBIDDEN" };

const ACTIONS = {
  "subagent.start": "agent.event.subagent.start",
  "subagent.stop": "agent.event.subagent.stop",
  "subagent.tool.call": "agent.event.subagent.tool.call",
} as const;

export async function recordEvent(
  principal: AgentPrincipal,
  sessionNoteId: string,
  input: AgentEventInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<EventOutcome> {
  const [note] = await db
    .select({
      id: notes.id,
      orgId: notes.orgId,
      deletedAt: notes.deletedAt,
    })
    .from(notes)
    .where(eq(notes.id, sessionNoteId))
    .limit(1);

  if (!note || note.deletedAt) return { ok: false, error: "NOT_FOUND" };
  if (note.orgId !== principal.orgId) {
    log.warn(
      { sessionNoteId, principalOrgId: principal.orgId, noteOrgId: note.orgId },
      "agent.event.cross-org.reject",
    );
    return { ok: false, error: "FORBIDDEN" };
  }

  await audit({
    action: ACTIONS[input.kind],
    orgId: principal.orgId,
    userId: principal.userId,
    resourceType: "note",
    resourceId: sessionNoteId,
    metadata: {
      tokenId: principal.tokenId,
      tokenName: principal.tokenName,
      agentId: input.agentId,
      agentType: input.agentType,
      toolName: input.toolName,
      ...input.detail,
    },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return { ok: true };
}
