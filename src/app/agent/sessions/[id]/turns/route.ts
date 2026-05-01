import { z } from "zod";
import { clientMeta, requireAgentPrincipal } from "@/lib/agent";
import { audit } from "@/lib/log/audit";
import { log } from "@/lib/log";
import { err, fromZod, ok, toResponse } from "@/lib/validation/result";
import { addTurn } from "@/lib/agent/conversation";
import { db } from "@/lib/db/client";
import { notes } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

const turnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(50_000),
  noteRefs: z
    .array(
      z.object({
        noteId: z.string().uuid(),
        version: z.number().int().optional(),
        title: z.string().max(200).optional(),
      }),
    )
    .max(20)
    .default([]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAgentPrincipal(request);
  const meta = clientMeta(request);

  if (!auth.ok) {
    if (auth.error.code === "UNAUTHORIZED" || auth.error.code === "FORBIDDEN") {
      await audit({
        action: "agent.conversation.auth.fail",
        metadata: { route: "turns", reason: auth.error.code },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }
    return toResponse(auth.error);
  }

  const { id } = await params;
  const idParsed = idSchema.safeParse(id);
  if (!idParsed.success) {
    return toResponse(err("VALIDATION", "Invalid session note id"));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return toResponse(err("VALIDATION", "Invalid JSON body"));
  }

  const parsed = turnSchema.safeParse(body);
  if (!parsed.success) return toResponse(fromZod(parsed.error as z.ZodError));

  // Verify the note belongs to the principal's org
  const [note] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.id, idParsed.data), eq(notes.orgId, auth.principal.orgId)))
    .limit(1);

  if (!note) {
    return toResponse(err("FORBIDDEN", "Session note belongs to a different org or does not exist."));
  }

  try {
    const result = await addTurn({
      orgId: auth.principal.orgId,
      sessionNoteId: idParsed.data,
      role: parsed.data.role,
      content: parsed.data.content,
      noteRefs: parsed.data.noteRefs,
    });

    await audit({
      action: "agent.conversation.turn",
      orgId: auth.principal.orgId,
      userId: auth.principal.userId,
      resourceType: "note",
      resourceId: idParsed.data,
      metadata: {
        role: parsed.data.role,
        contentLength: parsed.data.content.length,
        noteRefCount: parsed.data.noteRefs.length,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return toResponse(ok(result));
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return toResponse(err("NOT_FOUND", "Session note not found."));
    }
    log.error(
      { err: error, orgId: auth.principal.orgId, sessionNoteId: idParsed.data },
      "agent.conversation.turn.fail",
    );
    return toResponse(err("INTERNAL", "Failed to record conversation turn."));
  }
}
