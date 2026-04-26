/**
 * STUB — owned by `search` module agent.
 *
 * Replace with: query input, ranked results across title/content/tags,
 * filters (visibility, author, tag, date), highlighted snippets.
 *
 * Implementation must:
 *   1. Always include `org_id = $1` AND `deleted_at IS NULL` in WHERE.
 *   2. Use the GENERATED `search_vector` GIN index for full-text relevance.
 *   3. Layer pg_trgm similarity on `title` for typo tolerance.
 *   4. Filter results through note visibility / sharing in SQL — do not
 *      post-filter in JS (kills pagination correctness).
 */
export default async function SearchStub({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Search</h1>
      <p className="text-sm text-muted-foreground">
        Stub — search agent will replace this. orgId: <code>{orgId}</code>
      </p>
    </div>
  );
}
