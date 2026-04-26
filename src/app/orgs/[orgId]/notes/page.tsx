import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireUser } from "@/lib/auth/session";
import { listNotesForUser, notesListQuerySchema } from "@/lib/notes";
import { createNoteAction } from "./actions";
import { EmptyState, FlashNotice, VisibilityBadge, formatTimestamp } from "./components";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export const metadata = { title: "Notes" };

export default async function NotesPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgId } = await params;
  const user = await requireUser(`/orgs/${orgId}/notes`);
  const query = await searchParams;

  const parsed = notesListQuerySchema.safeParse({
    orgId,
    q: first(query.q),
    visibility: first(query.visibility),
    authorId: first(query.authorId),
    tag: first(query.tag),
  });

  const data = await listNotesForUser(parsed.success ? parsed.data : { orgId }, user.id);
  const myRole = data.members.find((member) => member.id === user.id)?.role ?? "viewer";
  const canCreate = myRole !== "viewer";
  const createAction = createNoteAction.bind(null, orgId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Notes</h1>
          <p className="text-sm text-muted-foreground">
            Filter by author, tag, or visibility. Version history and sharing live on each note.
          </p>
        </div>
      </div>

      <FlashNotice message={first(query.message)} error={first(query.error)} />

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Search within notes you can currently read in this organisation.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-4">
            <input type="hidden" name="orgId" value={orgId} />
            <Input name="q" placeholder="Search title or content" defaultValue={first(query.q) ?? ""} />
            <select
              name="visibility"
              defaultValue={first(query.visibility) ?? ""}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All visibility</option>
              <option value="private">Private</option>
              <option value="org">Org</option>
              <option value="shared">Shared</option>
            </select>
            <select
              name="authorId"
              defaultValue={first(query.authorId) ?? ""}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All authors</option>
              {data.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName ?? member.email}
                </option>
              ))}
            </select>
            <select
              name="tag"
              defaultValue={first(query.tag) ?? ""}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All tags</option>
              {data.availableTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
            <div className="md:col-span-4 flex items-center gap-3">
              <Button type="submit">Apply filters</Button>
              <Button variant="ghost" asChild>
                <Link href={`/orgs/${orgId}/notes`}>Reset</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {canCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Create note</CardTitle>
            <CardDescription>Members and above can create notes, tags, and the initial version snapshot.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createAction} className="grid gap-3">
              <Input name="title" placeholder="Sprint retro" required />
              <textarea
                name="content"
                rows={8}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Write the note body here..."
              />
              <div className="grid gap-3 md:grid-cols-3">
                <select
                  name="visibility"
                  defaultValue="org"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="private">Private</option>
                  <option value="org">Org visible</option>
                  <option value="shared">Shared only</option>
                </select>
                <Input name="tags" placeholder="roadmap, planning, retro" />
                <Input name="changeSummary" placeholder="Initial version summary" />
              </div>
              <div>
                <Button type="submit">Create note</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {data.notes.length === 0 ? (
        <EmptyState
          title="No matching notes"
          description="Try widening the filters, or create the first note if your role allows it."
        />
      ) : (
        <div className="grid gap-4">
          {data.notes.map((note) => (
            <Card key={note.id} className="transition hover:border-foreground/20">
              <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-xl">
                      <Link href={`/orgs/${orgId}/notes/${note.id}`} className="hover:underline">
                        {note.title}
                      </Link>
                    </CardTitle>
                    <VisibilityBadge visibility={note.visibility} />
                  </div>
                  <CardDescription>
                    {note.author.displayName ?? note.author.email} · updated {formatTimestamp(note.updatedAt)}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/orgs/${orgId}/notes/${note.id}`}>Open</Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/orgs/${orgId}/notes/${note.id}/history`}>History</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{note.excerpt || "No content yet."}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>v{note.currentVersion}</span>
                  <span>·</span>
                  <span>{note.shareCount} share{note.shareCount === 1 ? "" : "s"}</span>
                  {note.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-muted px-2 py-1 font-medium text-foreground">
                      #{tag}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
