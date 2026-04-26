import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { acceptedSummaryShape, summaryShape } from "@/lib/ai/schema";
import { assertCanReadNote, PermissionError } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { aiSummaries, notes } from "@/lib/db/schema";
import { AcceptSummaryForm } from "./accept-summary-form";
import { GenerateSummaryButton } from "./generate-summary-button";

export default async function NoteSummaryPage({
  params,
}: {
  params: Promise<{ orgId: string; noteId: string }>;
}) {
  const { orgId, noteId } = await params;
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Unauthenticated access should be blocked before rendering summary page");
  }

  try {
    await assertCanReadNote(noteId, user.id);
  } catch (error) {
    if (error instanceof PermissionError) {
      return (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold">Summary unavailable</h1>
          <p className="text-sm text-muted-foreground">
            {error.reason === "not-found"
              ? "The note does not exist."
              : "You do not have permission to view this note summary."}
          </p>
          <Link className="text-sm underline" href={`/orgs/${orgId}/notes`}>
            Back to notes
          </Link>
        </div>
      );
    }

    throw error;
  }

  const [note] = await db
    .select({
      id: notes.id,
      title: notes.title,
      currentVersion: notes.currentVersion,
      content: notes.content,
    })
    .from(notes)
    .where(eq(notes.id, noteId))
    .limit(1);

  if (!note) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Summary unavailable</h1>
        <p className="text-sm text-muted-foreground">The note does not exist.</p>
      </div>
    );
  }

  const [latestSummary] = await db
    .select({
      id: aiSummaries.id,
      status: aiSummaries.status,
      provider: aiSummaries.provider,
      model: aiSummaries.model,
      noteVersion: aiSummaries.noteVersion,
      structured: aiSummaries.structured,
      acceptedFields: aiSummaries.acceptedFields,
      errorMessage: aiSummaries.errorMessage,
      createdAt: aiSummaries.createdAt,
      updatedAt: aiSummaries.updatedAt,
    })
    .from(aiSummaries)
    .where(eq(aiSummaries.noteId, noteId))
    .orderBy(desc(aiSummaries.createdAt))
    .limit(1);

  const parsedStructured = latestSummary ? summaryShape.safeParse(latestSummary.structured) : null;
  const parsedAccepted = latestSummary ? acceptedSummaryShape.safeParse(latestSummary.acceptedFields) : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link className="text-sm underline" href={`/orgs/${orgId}/notes`}>
          Back to notes
        </Link>
        <h1 className="text-2xl font-semibold">AI summary</h1>
        <p className="text-sm text-muted-foreground">
          Note: <span className="font-medium text-foreground">{note.title}</span> · version{" "}
          {note.currentVersion}
        </p>
      </div>

      <GenerateSummaryButton noteId={noteId} />

      {!latestSummary ? (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            No summary has been generated for this note yet.
          </p>
        </div>
      ) : null}

      {latestSummary ? (
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>Status: {latestSummary.status}</span>
            <span>Provider: {latestSummary.provider}</span>
            <span>Model: {latestSummary.model}</span>
            <span>Summary version: {latestSummary.noteVersion}</span>
          </div>

          {latestSummary.errorMessage ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {latestSummary.errorMessage}
            </div>
          ) : null}

          {parsedStructured?.success ? (
            <div className="space-y-5">
              <section className="space-y-2">
                <h2 className="text-lg font-semibold">TL;DR</h2>
                <p className="text-sm leading-6">{parsedStructured.data.tldr}</p>
              </section>

              <section className="space-y-2">
                <h2 className="text-lg font-semibold">Key points</h2>
                <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
                  {parsedStructured.data.keyPoints.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </section>

              <section className="space-y-2">
                <h2 className="text-lg font-semibold">Action items</h2>
                {parsedStructured.data.actionItems.length ? (
                  <ul className="space-y-2 text-sm leading-6">
                    {parsedStructured.data.actionItems.map((item) => (
                      <li key={`${item.text}-${item.owner ?? "none"}`} className="rounded-md border p-3">
                        <p>{item.text}</p>
                        <p className="text-xs text-muted-foreground">
                          Owner: {item.owner ?? "Unassigned"}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No action items detected.</p>
                )}
              </section>

              <section className="space-y-2">
                <h2 className="text-lg font-semibold">Entities</h2>
                {parsedStructured.data.entities.length ? (
                  <ul className="flex flex-wrap gap-2 text-sm">
                    {parsedStructured.data.entities.map((entity) => (
                      <li key={`${entity.kind}-${entity.name}`} className="rounded-full border px-3 py-1">
                        {entity.name} · {entity.kind}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No entities extracted.</p>
                )}
              </section>

              <AcceptSummaryForm
                acceptedFields={parsedAccepted?.success ? parsedAccepted.data : null}
                noteId={noteId}
                orgId={orgId}
                structured={parsedStructured.data}
                summaryId={latestSummary.id}
              />
            </div>
          ) : (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Stored summary output is invalid and cannot be rendered.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
