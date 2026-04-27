import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireUser } from "@/lib/auth/session";
import { listNotesForUser, notesListQuerySchema } from "@/lib/notes";
import { createNoteAction } from "./actions";
import { FlashNotice } from "./components";
import { NotesList } from "./_components/notes-list";
import { SubmitButton } from "./_components/submit-button";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export const metadata = { title: "Notes Orgs" };

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
    visibility: first(query.visibility) || undefined,
    authorId: first(query.authorId) || undefined,
    tag: first(query.tag) || undefined,
  });

  const data = await listNotesForUser(parsed.success ? parsed.data : { orgId, limit: 25 }, user.id);
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
          <form className="grid gap-3 md:grid-cols-3">
            <input type="hidden" name="orgId" value={orgId} />
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
            <div className="md:col-span-3 flex items-center gap-3">
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
                <SubmitButton pendingText="Creating…">Create note</SubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <NotesList
        orgId={orgId}
        initialNotes={data.notes}
        initialNextCursor={data.nextCursor}
        query={{
          visibility: first(query.visibility),
          authorId: first(query.authorId),
          tag: first(query.tag),
        }}
      />
    </div>
  );
}
