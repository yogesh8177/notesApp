import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import {
  buildVersionDiff,
  getNoteDetailForUser,
  getNoteVersionsForUser,
  historyQuerySchema,
  toNotesErr,
} from "@/lib/notes";
import { DiffBlock, EmptyState, FlashNotice, SectionCard, VisibilityBadge, formatTimestamp } from "../../components";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NoteHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string; noteId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgId, noteId } = await params;
  const query = await searchParams;
  const user = await requireUser(`/orgs/${orgId}/notes/${noteId}/history`);
  let noteData;
  let historyData;
  try {
    [noteData, historyData] = await Promise.all([
      getNoteDetailForUser(noteId, user.id),
      getNoteVersionsForUser(noteId, user.id),
    ]);
  } catch (error) {
    const mapped = toNotesErr(error);
    if (mapped.code === "NOT_FOUND") {
      notFound();
    }
    return (
      <div className="space-y-6">
        <FlashNotice error={mapped.message} />
        <EmptyState
          title="History unavailable"
          description="You no longer have permission to inspect this note's version history."
          href={`/orgs/${orgId}/notes`}
          cta="Back to notes"
        />
      </div>
    );
  }

  const { note } = noteData;

  const parsed = historyQuerySchema.safeParse({
    version: first(query.version),
    compareTo: first(query.compareTo),
  });

  const selected =
    (parsed.success && parsed.data.version
      ? historyData.versions.find((version) => version.version === parsed.data.version)
      : undefined) ?? historyData.versions[0];

  const compareTo =
    (parsed.success && parsed.data.compareTo
      ? historyData.versions.find((version) => version.version === parsed.data.compareTo)
      : undefined) ??
    historyData.versions.find((version) => version.version === selected.version - 1) ??
    selected;

  const diff = buildVersionDiff(compareTo, selected);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">History</h1>
            <VisibilityBadge visibility={note.visibility} />
          </div>
          <p className="text-sm text-muted-foreground">
            {note.title} · current version {note.currentVersion}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href={`/orgs/${orgId}/notes/${noteId}`}>Back to note</Link>
          </Button>
        </div>
      </div>

      <FlashNotice message={first(query.message)} error={first(query.error)} />

      {historyData.versions.length === 0 ? (
        <EmptyState title="No versions" description="This note does not have any saved versions yet." />
      ) : (
        <>
          <SectionCard
            title={`Comparing v${selected.version} against v${compareTo.version}`}
            description="Diff output is line-based across title and content snapshots."
          >
            <div className="space-y-6">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-semibold">Selected version</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    v{selected.version} · {formatTimestamp(selected.createdAt)} · {selected.visibility}
                  </p>
                  {selected.changeSummary ? (
                    <p className="mt-2 text-sm text-muted-foreground">{selected.changeSummary}</p>
                  ) : null}
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-semibold">Compared against</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    v{compareTo.version} · {formatTimestamp(compareTo.createdAt)} · {compareTo.visibility}
                  </p>
                  {compareTo.changeSummary ? (
                    <p className="mt-2 text-sm text-muted-foreground">{compareTo.changeSummary}</p>
                  ) : null}
                </div>
              </div>
              <DiffBlock label="Title" lines={diff.title} />
              <DiffBlock label="Content" lines={diff.content} />
            </div>
          </SectionCard>

          <SectionCard title="All versions" description="Pick any pair to inspect a specific change window.">
            <div className="space-y-3">
              {historyData.history.map((entry) => {
                const defaultCompare = entry.version > 1 ? entry.version - 1 : entry.version;
                return (
                  <div key={entry.id} className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        v{entry.version} · {entry.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatTimestamp(entry.createdAt)} by {entry.changedBy.displayName ?? entry.changedBy.email}
                        {entry.changeSummary ? ` · ${entry.changeSummary}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link
                          href={`/orgs/${orgId}/notes/${noteId}/history?version=${entry.version}&compareTo=${defaultCompare}`}
                        >
                          Compare to previous
                        </Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
