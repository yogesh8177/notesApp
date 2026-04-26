import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { summarize, SummarizeProvidersError } from "@/lib/ai/provider";
import { consumeSummaryToken } from "@/lib/ai/rate-limit";
import { assertCanReadNote, PermissionError } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { aiSummaries, notes } from "@/lib/db/schema";
import { audit } from "@/lib/log/audit";
import { err, ok, toResponse } from "@/lib/validation/result";

const paramsSchema = z.object({
  noteId: z.string().uuid(),
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ noteId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return toResponse(err("UNAUTHORIZED", "Sign in required"));
  }

  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return toResponse(err("VALIDATION", "Invalid note id", parsedParams.error.flatten().fieldErrors));
  }

  const { noteId } = parsedParams.data;

  try {
    await assertCanReadNote(noteId, user.id);
  } catch (error) {
    return permissionErrorToResponse(error);
  }

  const rateLimit = consumeSummaryToken(user.id);
  if (!rateLimit.ok) {
    return NextResponse.json(err("RATE_LIMITED", "Summary rate limit exceeded"), {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)),
      },
    });
  }

  const [note] = await db
    .select({
      id: notes.id,
      orgId: notes.orgId,
      title: notes.title,
      content: notes.content,
      currentVersion: notes.currentVersion,
    })
    .from(notes)
    .where(eq(notes.id, noteId))
    .limit(1);

  if (!note) {
    return toResponse(err("NOT_FOUND", "Note not found"));
  }

  const [pendingSummary] = await db
    .insert(aiSummaries)
    .values({
      noteId,
      noteVersion: note.currentVersion,
      provider: "anthropic",
      model: "pending",
      status: "pending",
      createdBy: user.id,
    })
    .returning({
      id: aiSummaries.id,
    });

  const startedAt = Date.now();

  await audit({
    action: "ai.summary.request",
    orgId: note.orgId,
    userId: user.id,
    resourceType: "ai_summary",
    resourceId: pendingSummary.id,
    metadata: {
      noteId,
      provider: "anthropic",
      model: "pending",
      latencyMs: 0,
    },
  });

  try {
    const result = await summarize({
      title: note.title,
      content: note.content,
    });

    const latencyMs = Date.now() - startedAt;

    if (result.provider === "openai") {
      await audit({
        action: "ai.summary.fallback",
        orgId: note.orgId,
        userId: user.id,
        resourceType: "ai_summary",
        resourceId: pendingSummary.id,
        metadata: {
          noteId,
          provider: result.provider,
          model: result.model,
          latencyMs,
        },
      });
    }

    await db
      .update(aiSummaries)
      .set({
        provider: result.provider,
        model: result.model,
        rawOutput: result.raw,
        structured: result.structured,
        status: "completed",
        errorMessage: null,
      })
      .where(eq(aiSummaries.id, pendingSummary.id));

    await audit({
      action: "ai.summary.complete",
      orgId: note.orgId,
      userId: user.id,
      resourceType: "ai_summary",
      resourceId: pendingSummary.id,
      metadata: {
        noteId,
        provider: result.provider,
        model: result.model,
        latencyMs,
      },
    });

    return toResponse(
      ok({
        summaryId: pendingSummary.id,
        provider: result.provider,
        model: result.model,
        status: "completed" as const,
        structured: result.structured,
      }),
    );
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const failure = normalizeSummaryFailure(error);
    const usedFallback = failure.attempts.some((attempt) => attempt.provider === "openai");
    const lastAttempt = failure.attempts.at(-1) ?? {
      provider: "anthropic" as const,
      model: "pending",
      kind: "upstream" as const,
      message: "Unknown provider failure",
    };

    if (usedFallback) {
      await audit({
        action: "ai.summary.fallback",
        orgId: note.orgId,
        userId: user.id,
        resourceType: "ai_summary",
        resourceId: pendingSummary.id,
        metadata: {
          noteId,
          provider: "openai",
          model: failure.attempts.find((attempt) => attempt.provider === "openai")?.model ?? "unknown",
          latencyMs,
        },
      });
    }

    await db
      .update(aiSummaries)
      .set({
        provider: lastAttempt.provider,
        model: lastAttempt.model,
        status: "failed",
        errorMessage: formatSummaryFailureMessage(failure),
      })
      .where(eq(aiSummaries.id, pendingSummary.id));

    await audit({
      action: "ai.summary.fail",
      orgId: note.orgId,
      userId: user.id,
      resourceType: "ai_summary",
      resourceId: pendingSummary.id,
      metadata: {
        noteId,
        provider: lastAttempt.provider,
        model: lastAttempt.model,
        latencyMs,
      },
    });

    return toResponse(err("UPSTREAM", "Summary generation failed"));
  }
}

function permissionErrorToResponse(error: unknown) {
  if (error instanceof PermissionError) {
    if (error.reason === "not-found") {
      return toResponse(err("NOT_FOUND", "Note not found"));
    }
    return toResponse(err("FORBIDDEN", "You do not have access to this note"));
  }

  return toResponse(err("INTERNAL", "Unable to verify note access"));
}

function normalizeSummaryFailure(error: unknown): SummarizeProvidersError {
  if (error instanceof SummarizeProvidersError) {
    return error;
  }

  return new SummarizeProvidersError("Summary provider failure", [
    {
      provider: "anthropic",
      model: "unknown",
      kind: "upstream",
      message: error instanceof Error ? error.message : String(error),
    },
  ]);
}

function formatSummaryFailureMessage(error: SummarizeProvidersError): string {
  return error.attempts
    .map((attempt) => `${attempt.provider}/${attempt.model} [${attempt.kind}]: ${attempt.message}`)
    .join(" | ");
}
