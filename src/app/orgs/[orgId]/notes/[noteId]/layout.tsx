import { NoteTabNav } from "./note-tab-nav";

export default async function NoteDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgId: string; noteId: string }>;
}) {
  const { orgId, noteId } = await params;

  return (
    <div className="space-y-4">
      <NoteTabNav orgId={orgId} noteId={noteId} />
      <div>{children}</div>
    </div>
  );
}
