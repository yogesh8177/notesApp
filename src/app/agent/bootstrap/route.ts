import { z } from "zod";
import {
  bootstrap,
  bootstrapSchema,
  clientMeta,
  requireAgentPrincipal,
} from "@/lib/agent";
import { audit } from "@/lib/log/audit";
import { log } from "@/lib/log";
import { err, fromZod, ok, toResponse } from "@/lib/validation/result";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAgentPrincipal(request);
  const meta = clientMeta(request);

  if (!auth.ok) {
    if (auth.error.code === "UNAUTHORIZED" || auth.error.code === "FORBIDDEN") {
      await audit({
        action: "agent.session.auth.fail",
        metadata: { route: "bootstrap", reason: auth.error.code },
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

  const parsed = bootstrapSchema.safeParse(body);
  if (!parsed.success) return toResponse(fromZod(parsed.error as z.ZodError));

  try {
    const result = await bootstrap(auth.principal, parsed.data, meta);
    return toResponse(ok(result));
  } catch (error) {
    log.error(
      { err: error, orgId: auth.principal.orgId },
      "agent.bootstrap.fail",
    );
    return toResponse(err("INTERNAL", "Failed to bootstrap agent session."));
  }
}
