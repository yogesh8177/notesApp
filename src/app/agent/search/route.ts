import { z } from "zod";
import { searchNotes } from "@/lib/search";
import { audit } from "@/lib/log/audit";
import { log } from "@/lib/log";
import { clientMeta, requireAgentPrincipal } from "@/lib/agent";
import { err, fromZod, ok, toResponse } from "@/lib/validation/result";

export const dynamic = "force-dynamic";

/**
 * Bearer-authed search wrapper around src/lib/search/service.ts.
 *
 * Why this duplicates the MCP `search_notes` tool: the MCP path serves a
 * conversational client (the model calls it as a tool); this HTTP path serves
 * hook automation (the recall.js UserPromptSubmit hook). Same backing helper,
 * same auth, same audit type — different transport optimised for each caller.
 *
 * Hooks fire on every user prompt and need a one-shot HTTP request, not a
 * three-step MCP handshake. Keeping this endpoint thin (zod in, JSON out) is
 * the right trade-off vs forcing the hook to speak JSON-RPC.
 */
const requestSchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(20).default(5),
  tag: z.string().trim().min(1).max(64).optional(),
});

export async function POST(request: Request) {
  const auth = await requireAgentPrincipal(request);
  const meta = clientMeta(request);

  if (!auth.ok) {
    if (auth.error.code === "UNAUTHORIZED" || auth.error.code === "FORBIDDEN") {
      await audit({
        action: "agent.search.auth.fail",
        metadata: { reason: auth.error.code },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }
    return toResponse(auth.error);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return toResponse(err("VALIDATION", "Invalid JSON body"));
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return toResponse(fromZod(parsed.error));

  const startedAt = Date.now();
  try {
    const response = await searchNotes(
      {
        orgId: auth.principal.orgId,
        q: parsed.data.q,
        tag: parsed.data.tag,
        visibility: "all",
        page: 1,
        pageSize: parsed.data.limit,
      },
      { orgId: auth.principal.orgId, userId: auth.principal.userId },
    );

    await audit({
      action: "agent.search",
      orgId: auth.principal.orgId,
      userId: auth.principal.userId,
      resourceType: "search",
      metadata: {
        qLength: parsed.data.q.length,
        resultCount: response.results.length,
        durationMs: Date.now() - startedAt,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return toResponse(
      ok({
        count: response.results.length,
        results: response.results.map((r) => ({
          id: r.id,
          title: r.title,
          snippet: r.snippet,
          updatedAt: r.updatedAt,
          score: r.score,
          tags: r.tags,
        })),
      }),
    );
  } catch (error) {
    log.error(
      { err: error, orgId: auth.principal.orgId },
      "agent.search.fail",
    );
    return toResponse(err("INTERNAL", "Search failed."));
  }
}
