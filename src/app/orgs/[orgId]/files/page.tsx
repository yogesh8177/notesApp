import { FilesClient } from "./files-client";

export default async function FilesPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return <FilesClient orgId={orgId} />;
}
