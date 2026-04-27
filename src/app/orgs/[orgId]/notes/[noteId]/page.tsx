import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireUser } from "@/lib/auth/session";
import { getNoteDetailForUser, toNotesErr } from "@/lib/notes";
import { deleteNoteAction, removeShareAction, updateNoteAction, upsertShareAction } from "../actions";
import { EmptyState, FlashNotice, SectionCard, VisibilityBadge, formatTimestamp } from "../components";
import { SubmitButton } from "../_components/submit-button";
import { NoteFileUploader } from "@/app/orgs/[orgId]/files/_components/note-file-uploader";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NoteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string; noteId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgId, noteId } = await params;
  const query = await searchParams;
  const user = await requireUser(`/orgs/${orgId}/notes/${noteId}`);
  let detail;
  try {
    detail = await getNoteDetailForUser(noteId, user.id);
  } catch (error) {
    const mapped = toNotesErr(error);
    if (mapped.code === "NOT_FOUND") {
      notFound();
    }
    return (
      <div className="space-y-6">
        <FlashNotice error={mapped.message} />
        <EmptyState
          title="Note unavailable"
          description="You no longer have access to this note, or it was removed."
          href={`/orgs/${orgId}/notes`}
          cta="Back to notes"
        />
      </div>
    );
  }

  const { note, members } = detail;

  const updateAction = updateNoteAction.bind(null, orgId, noteId);
  const deleteAction = deleteNoteAction.bind(null, orgId, noteId);
  const shareAction = upsertShareAction.bind(null, orgId, noteId);
  const shareTargets = members.filter((member) => member.id !== note.authorId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{note.title}</h1>
            <VisibilityBadge visibility={note.visibility} />
          </div>
          <p className="text-sm text-muted-foreground">
            Author: {note.author.displayName ?? note.author.email} · version {note.currentVersion} · updated{" "}
            {formatTimestamp(note.updatedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href={`/orgs/${orgId}/notes`}>Back to list</Link>
          </Button>
          <Button asChild>
            <Link href={`/orgs/${orgId}/notes/${noteId}/history`}>View history</Link>
          </Button>
        </div>
      </div>

      <FlashNotice message={first(query.message)} error={first(query.error)} />

      <SectionCard
        title={note.permissions.canWrite ? "Edit note" : "Read note"}
        description="Edits create a new version snapshot. Visibility changes are limited to the author or an org admin."
      >
        {note.permissions.canWrite ? (
          <form action={updateAction} className="space-y-4">
            <Input name="title" defaultValue={note.title} required />
            <textarea
              name="content"
              rows={16}
              defaultValue={note.content}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <div className="grid gap-3 md:grid-cols-3">
              <select
                name="visibility"
                defaultValue={note.visibility}
                disabled={!note.permissions.canShare}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
              >
                <option value="private">Private</option>
                <option value="org">Org visible</option>
                <option value="shared">Shared only</option>
              </select>
              <Input name="tags" defaultValue={note.tags.join(", ")} placeholder="one, two, three" />
              <Input name="changeSummary" placeholder="What changed?" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
              {note.permissions.canDelete ? (
                <SubmitButton formAction={deleteAction} variant="destructive" pendingText="Deleting…">
                  Delete note
                </SubmitButton>
              ) : null}
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-4 whitespace-pre-wrap text-sm">{note.content || "No content."}</div>
            <div className="flex flex-wrap gap-2">
              {note.tags.length === 0 ? <span className="text-sm text-muted-foreground">No tags.</span> : null}
              {note.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-muted px-2 py-1 text-xs font-medium">
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      {note.permissions.canWrite ? (
        <SectionCard title="Current content" description="Rendered from the current saved version.">
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-4 whitespace-pre-wrap text-sm">{note.content || "No content."}</div>
            <div className="flex flex-wrap gap-2">
              {note.tags.length === 0 ? <span className="text-sm text-muted-foreground">No tags.</span> : null}
              {note.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-muted px-2 py-1 text-xs font-medium">
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Attachments" description="Up to 5 files per note. Files are stored in private org storage.">
        <NoteFileUploader noteId={noteId} orgId={orgId} canWrite={note.permissions.canWrite} />
      </SectionCard>

      {note.permissions.canShare ? (
        <SectionCard
          title="Sharing"
          description="Shares are restricted to members of this organisation. Adding the first share automatically moves the note to shared visibility."
        >
          <div className="space-y-4">
            <form action={shareAction} className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
              <select
                name="sharedWithUserId"
                required
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Choose a member</option>
                {shareTargets.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName ?? member.email} ({member.role})
                  </option>
                ))}
              </select>
              <select
                name="permission"
                defaultValue="view"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="view">Can view</option>
                <option value="edit">Can edit</option>
              </select>
              <SubmitButton pendingText="Saving…">Add or update share</SubmitButton>
            </form>

            {note.shares.length === 0 ? (
              <EmptyState
                title="No shares yet"
                description="This note is only visible through its current visibility rules."
              />
            ) : (
              <div className="space-y-3">
                {note.shares.map((share) => {
                  const removeAction = removeShareAction.bind(null, orgId, noteId, share.id);
                  return (
                    <div key={share.id} className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-medium">
                          {share.sharedWith.displayName ?? share.sharedWith.email}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {share.permission} access · shared by {share.sharedBy.displayName ?? share.sharedBy.email}
                        </p>
                      </div>
                      <form action={removeAction}>
                        <SubmitButton size="sm" variant="outline" pendingText="…">
                          Remove
                        </SubmitButton>
                      </form>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Recent versions" description="The full diff viewer lives in History.">
        <div className="space-y-3">
          {note.history.slice(0, 5).map((version) => (
            <div key={version.id} className="flex flex-col gap-2 rounded-lg border p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium">
                  v{version.version} · {version.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatTimestamp(version.createdAt)} by {version.changedBy.displayName ?? version.changedBy.email}
                  {version.changeSummary ? ` · ${version.changeSummary}` : ""}
                </p>
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link href={`/orgs/${orgId}/notes/${noteId}/history?version=${version.version}`}>Inspect diff</Link>
              </Button>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
