import { z } from "zod";
import {
  agentEventSchema,
  clientMeta,
  recordEvent,
  requireAgentPrincipal,
} from "@/lib/agent";
import { audit } from "@/lib/log/audit";
import { log } from "@/lib/log";
import { err, fromZod, ok, toResponse } from "@/lib/validation/result";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAgentPrincipal(request);
  const meta = clientMeta(request);

  if (!auth.ok) {
    if (auth.error.code === "UNAUTHORIZED" || auth.error.code === "FORBIDDEN") {
      await audit({
        action: "agent.session.auth.fail",
        metadata: { route: "event", reason: auth.error.code },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }
    return toResponse(auth.error);
  }

  const { id } = await params;
  const idParsed = idSchema.safeParse(id);
  if (!idParsed.success) {
    return toResponse(err("VALIDATION", "Invalid session id"));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return toResponse(err("VALIDATION", "Invalid JSON body"));
  }

  const parsed = agentEventSchema.safeParse(body);
  if (!parsed.success) return toResponse(fromZod(parsed.error));

  try {
    const outcome = await recordEvent(
      auth.principal,
      idParsed.data,
      parsed.data,
      meta,
    );
    if (!outcome.ok) {
      if (outcome.error === "NOT_FOUND") {
        return toResponse(err("NOT_FOUND", "Session note not found."));
      }
      return toResponse(
        err("FORBIDDEN", "Session note belongs to a different org."),
      );
    }
    return toResponse(ok({ recorded: true }));
  } catch (error) {
    log.error(
      { err: error, orgId: auth.principal.orgId, sessionNoteId: idParsed.data },
      "agent.event.fail",
    );
    return toResponse(err("INTERNAL", "Failed to record event."));
  }
}
