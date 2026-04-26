/**
 * STUB — owned by `files` module agent.
 *
 * Replace with: org-level file list, upload UI, download via signed URL,
 * delete (own or admin), per-note attachment UI under /notes/[id].
 */
export default async function FilesStub({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Files</h1>
      <p className="text-sm text-muted-foreground">
        Stub — files agent will replace this. orgId: <code>{orgId}</code>
      </p>
    </div>
  );
}
