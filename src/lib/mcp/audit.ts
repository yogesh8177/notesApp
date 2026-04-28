import { audit } from "@/lib/log/audit";
import type { AgentPrincipal } from "@/lib/agent";

/**
 * Wrap an async tool/resource handler with audit emission.
 *
 * Every call produces one `mcp.tool.call` row on success (with duration_ms and
 * any non-PII metadata the handler returns) and one `mcp.tool.error` row on
 * failure. The principal is taken from closure — same identity used to gate
 * the request in the route handler, so no chance of drift.
 */
export async function withAudit<T>(opts: {
  principal: AgentPrincipal;
  kind: "tool" | "resource";
  name: string;
  meta?: Record<string, unknown>;
  run: () => Promise<T>;
}): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await opts.run();
    await audit({
      action: opts.kind === "tool" ? "mcp.tool.call" : "mcp.resource.read",
      orgId: opts.principal.orgId,
      userId: opts.principal.userId,
      resourceType: "mcp",
      resourceId: opts.name,
      metadata: {
        ...opts.meta,
        durationMs: Date.now() - startedAt,
      },
    });
    return result;
  } catch (error) {
    await audit({
      action: opts.kind === "tool" ? "mcp.tool.error" : "mcp.resource.error",
      orgId: opts.principal.orgId,
      userId: opts.principal.userId,
      resourceType: "mcp",
      resourceId: opts.name,
      metadata: {
        ...opts.meta,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
