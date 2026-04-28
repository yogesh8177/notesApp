import { z } from "zod";
import {
  checkpoint,
  checkpointSchema,
  clientMeta,
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
        metadata: { route: "checkpoint", reason: auth.error.code },
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

  const parsed = checkpointSchema.safeParse(body);
  if (!parsed.success) return toResponse(fromZod(parsed.error as z.ZodError));

  try {
    const outcome = await checkpoint(
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
    return toResponse(ok(outcome.result));
  } catch (error) {
    log.error(
      { err: error, orgId: auth.principal.orgId, sessionNoteId: idParsed.data },
      "agent.checkpoint.fail",
    );
    return toResponse(err("INTERNAL", "Failed to record checkpoint."));
  }
}
