"use client";

import { useActionState } from "react";
import type { AcceptedSummaryShape, SummaryField, SummaryShape } from "@/lib/ai/schema";
import type { Result } from "@/lib/validation/result";
import { acceptSummaryAction, type AcceptSummaryData } from "./actions";

const FIELD_LABELS: Record<SummaryField, string> = {
  tldr: "TL;DR",
  keyPoints: "Key points",
  actionItems: "Action items",
  entities: "Entities",
};

const ORDERED_FIELDS: SummaryField[] = ["tldr", "keyPoints", "actionItems", "entities"];

export function AcceptSummaryForm({
  acceptedFields,
  noteId,
  orgId,
  structured,
  summaryId,
}: {
  acceptedFields: AcceptedSummaryShape | null;
  noteId: string;
  orgId: string;
  structured: SummaryShape;
  summaryId: string;
}) {
  const [state, formAction, pending] = useActionState<Result<AcceptSummaryData> | null, FormData>(
    acceptSummaryAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4 rounded-lg border bg-card p-4">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="noteId" value={noteId} />
      <input type="hidden" name="summaryId" value={summaryId} />

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Accept fields</h2>
        <p className="text-sm text-muted-foreground">
          Choose which top-level sections should be written to <code>accepted_fields</code>.
        </p>
      </div>

      <div className="space-y-3">
        {ORDERED_FIELDS.map((field) => (
          <label key={field} className="flex items-start gap-3 rounded-md border p-3">
            <input
              defaultChecked={Boolean(acceptedFields?.[field]) || !acceptedFields}
              name="field"
              type="checkbox"
              value={field}
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium">{FIELD_LABELS[field]}</span>
              <span className="block text-xs text-muted-foreground">
                {describeField(field, structured)}
              </span>
            </span>
          </label>
        ))}
      </div>

      {state && !state.ok ? <p className="text-sm text-red-600">{state.message}</p> : null}
      {state?.ok ? (
        <p className="text-sm text-green-700">
          Accepted fields saved: {state.data.acceptedFields.join(", ") || "none"}
        </p>
      ) : null}

      <button
        className="inline-flex rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        disabled={pending}
        type="submit"
      >
        {pending ? "Saving..." : "Save accepted fields"}
      </button>
    </form>
  );
}

function describeField(field: SummaryField, structured: SummaryShape): string {
  switch (field) {
    case "tldr":
      return structured.tldr;
    case "keyPoints":
      return `${structured.keyPoints.length} key points`;
    case "actionItems":
      return `${structured.actionItems.length} action items`;
    case "entities":
      return `${structured.entities.length} extracted entities`;
  }
}
