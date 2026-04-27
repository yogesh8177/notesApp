import Link from "next/link";

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
      <nav className="flex gap-1 border-b pb-0">
        <Link
          href={`/orgs/${orgId}/notes/${noteId}`}
          className="rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          Note
        </Link>
        <Link
          href={`/orgs/${orgId}/notes/${noteId}/summary`}
          className="rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          AI Summary
        </Link>
      </nav>
      <div>{children}</div>
    </div>
  );
}
