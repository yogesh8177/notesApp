import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { clientMeta, requireAgentPrincipal } from "@/lib/agent";
import { audit } from "@/lib/log/audit";
import { log } from "@/lib/log";
import { createMcpServer } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MCP Streamable HTTP endpoint, stateless mode.
 *
 * Wire format: a single endpoint at /mcp accepts POST (JSON-RPC requests),
 * GET (server-initiated SSE — unused in stateless mode), and DELETE (session
 * close — unused in stateless mode). Each request is independent: a fresh
 * McpServer + transport are built, used once, and discarded. This makes the
 * service horizontally scalable with no shared state.
 *
 * Auth: Bearer token via the existing agent-token model. The same token used
 * by the .claude/hooks bridge authenticates here too. Auth happens BEFORE the
 * MCP handshake — invalid tokens are rejected at the route layer with 401,
 * not as JSON-RPC errors.
 */
async function handle(request: Request): Promise<Response> {
  const meta = clientMeta(request);
  const auth = await requireAgentPrincipal(request);

  if (!auth.ok) {
    if (auth.error.code === "UNAUTHORIZED" || auth.error.code === "FORBIDDEN") {
      await audit({
        action: "mcp.auth.fail",
        metadata: { reason: auth.error.code, method: request.method },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }
    return new Response(JSON.stringify(auth.error), {
      status: auth.error.code === "UNAUTHORIZED" ? 401 : 403,
      headers: { "content-type": "application/json" },
    });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless — no session ID issued, no in-memory connection state.
    sessionIdGenerator: undefined,
    // JSON responses (vs SSE) are simpler for clients and adequate for the
    // request/response tools we expose. SSE only matters for streaming
    // server-initiated messages, which we don't need.
    enableJsonResponse: true,
  });

  const server = createMcpServer(auth.principal);

  try {
    await server.connect(transport);
    return await transport.handleRequest(request, {
      authInfo: {
        token: "agent",
        clientId: auth.principal.userId,
        scopes: [],
        extra: { orgId: auth.principal.orgId },
      },
    });
  } catch (error) {
    log.error(
      { err: error, orgId: auth.principal.orgId, method: request.method },
      "mcp.transport.fail",
    );
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal error" },
        id: null,
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  } finally {
    // Free per-request state. close() resolves even if connect() never ran,
    // so no need to guard it.
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
