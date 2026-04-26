"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  acceptedSummaryShape,
  pickAcceptedSummaryFields,
  summaryFieldSchema,
  summaryShape,
} from "@/lib/ai/schema";
import { assertCanWriteNote, PermissionError } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { aiSummaries } from "@/lib/db/schema";
import { audit } from "@/lib/log/audit";
import { err, fromZod, ok, type Result } from "@/lib/validation/result";

const acceptSummaryInput = z.object({
  orgId: z.string().uuid(),
  noteId: z.string().uuid(),
  summaryId: z.string().uuid(),
  fields: z.array(summaryFieldSchema),
});

export interface AcceptSummaryData {
  acceptedFields: string[];
  status: "accepted";
}

export async function acceptSummaryAction(
  _previousState: Result<AcceptSummaryData> | null,
  formData: FormData,
): Promise<Result<AcceptSummaryData>> {
  const user = await getCurrentUser();
  if (!user) {
    return err("UNAUTHORIZED", "Sign in required");
  }

  const parsed = acceptSummaryInput.safeParse({
    orgId: formData.get("orgId"),
    noteId: formData.get("noteId"),
    summaryId: formData.get("summaryId"),
    fields: formData.getAll("field"),
  });

  if (!parsed.success) {
    return fromZod(parsed.error);
  }

  const { orgId, noteId, summaryId, fields } = parsed.data;

  try {
    await assertCanWriteNote(noteId, user.id);
  } catch (error) {
    if (error instanceof PermissionError) {
      if (error.reason === "not-found") {
        return err("NOT_FOUND", "Note not found");
      }
      return err("FORBIDDEN", "You do not have permission to accept this summary");
    }

    return err("INTERNAL", "Unable to verify note permissions");
  }

  const [summaryRow] = await db
    .select({
      id: aiSummaries.id,
      noteId: aiSummaries.noteId,
      provider: aiSummaries.provider,
      model: aiSummaries.model,
      structured: aiSummaries.structured,
    })
    .from(aiSummaries)
    .where(and(eq(aiSummaries.id, summaryId), eq(aiSummaries.noteId, noteId)))
    .limit(1);

  if (!summaryRow) {
    return err("NOT_FOUND", "Summary not found");
  }

  const parsedStructured = summaryShape.safeParse(summaryRow.structured);
  if (!parsedStructured.success) {
    return err("CONFLICT", "Stored summary is invalid");
  }

  const acceptedFields = pickAcceptedSummaryFields(parsedStructured.data, fields);
  const validAcceptedFields = acceptedSummaryShape.parse(acceptedFields);

  await db
    .update(aiSummaries)
    .set({
      acceptedFields: validAcceptedFields,
      status: "accepted",
      errorMessage: null,
    })
    .where(eq(aiSummaries.id, summaryId));

  await audit({
    action: "ai.summary.accept",
    orgId,
    userId: user.id,
    resourceType: "ai_summary",
    resourceId: summaryId,
    metadata: {
      noteId,
      provider: summaryRow.provider,
      model: summaryRow.model,
      latencyMs: 0,
      fields,
    },
  });

  revalidatePath(`/orgs/${orgId}/notes/${noteId}/summary`);

  return ok({
    acceptedFields: fields,
    status: "accepted",
  });
}
