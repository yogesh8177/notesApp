/**
 * STUB — owned by `notes-core` module agent.
 *
 * Replace with: notes list + filters (tag, visibility, author), create-note
 * affordance, link to /notes/[id]. Versioning + diff lives under
 * `/notes/[id]/history` and is owned by the same agent.
 */
export default async function NotesListStub({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Notes</h1>
      <p className="text-sm text-muted-foreground">
        Stub — notes-core agent will replace this. orgId: <code>{orgId}</code>
      </p>
    </div>
  );
}
