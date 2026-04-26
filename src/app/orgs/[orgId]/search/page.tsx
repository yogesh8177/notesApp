import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireOrgRole } from "@/lib/auth/org";
import {
  hasActiveSearchFilters,
  listSearchAuthors,
  listSearchTags,
  parseSearchRequest,
  safeParseSearchFilters,
  searchNotes,
} from "@/lib/search";
import { SearchHighlight } from "./highlight";
import { SearchSubmitButton } from "./search-button";

function buildSearchHref(
  orgId: string,
  current: {
    q?: string;
    visibility?: string;
    authorId?: string;
    tag?: string;
    from?: string;
    to?: string;
    pageSize?: number;
  },
  page: number,
) {
  const params = new URLSearchParams();

  if (current.q) params.set("q", current.q);
  if (current.visibility && current.visibility !== "all") params.set("visibility", current.visibility);
  if (current.authorId) params.set("authorId", current.authorId);
  if (current.tag) params.set("tag", current.tag);
  if (current.from) params.set("from", current.from);
  if (current.to) params.set("to", current.to);
  if (current.pageSize && current.pageSize !== 20) params.set("pageSize", String(current.pageSize));
  if (page > 1) params.set("page", String(page));

  const query = params.toString();
  return query ? `/orgs/${orgId}/search?${query}` : `/orgs/${orgId}/search`;
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgId } = await params;
  const context = await requireOrgRole(orgId, "viewer");
  const rawSearchParams = await searchParams;
  const { data: filters, error: filterError } = safeParseSearchFilters(rawSearchParams, orgId);

  const [authors, availableTags] = await Promise.all([
    listSearchAuthors(orgId),
    listSearchTags(orgId),
  ]);

  const shouldSearch = Boolean(filters.q);
  const parsedRequest = shouldSearch ? parseSearchRequest(rawSearchParams, orgId) : null;
  const response = parsedRequest
    ? await searchNotes(parsedRequest, {
        orgId,
        userId: context.userId,
      })
    : null;

  const activeAuthor = authors.find((author) => author.value === filters.authorId);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Search readable notes in this org with full-text ranking, fuzzy title matching, and
          filters for visibility, author, tag, and updated date. Prefix with{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">#tagname</code> to
          search by tag.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Find notes</CardTitle>
          <CardDescription>
            Results stay scoped to this org and only include notes you are allowed to read.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={`/orgs/${orgId}/search`} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2 xl:col-span-2">
              <label className="text-sm font-medium" htmlFor="q">
                Query
              </label>
              <Input
                defaultValue={filters.q ?? ""}
                id="q"
                maxLength={200}
                name="q"
                placeholder="Search title, content, tags — or #tagname"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="visibility">
                Visibility
              </label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                defaultValue={filters.visibility}
                id="visibility"
                name="visibility"
              >
                <option value="all">All readable notes</option>
                <option value="private">Private</option>
                <option value="org">Org</option>
                <option value="shared">Shared</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="authorId">
                Author
              </label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                defaultValue={filters.authorId ?? ""}
                id="authorId"
                name="authorId"
              >
                <option value="">All authors</option>
                {authors.map((author) => (
                  <option key={author.value} value={author.value}>
                    {author.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="tag">
                Tag filter
              </label>
              <Input
                defaultValue={filters.tag ?? ""}
                id="tag"
                list="search-tag-options"
                maxLength={64}
                name="tag"
                placeholder="Tag name"
              />
              <datalist id="search-tag-options">
                {availableTags.map((tag) => (
                  <option key={tag.value} value={tag.value} />
                ))}
              </datalist>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="from">
                Updated from
              </label>
              <Input defaultValue={filters.from ?? ""} id="from" name="from" type="date" />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="to">
                Updated to
              </label>
              <Input defaultValue={filters.to ?? ""} id="to" name="to" type="date" />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="pageSize">
                Page size
              </label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                defaultValue={String(filters.pageSize)}
                id="pageSize"
                name="pageSize"
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
              </select>
            </div>

            <div className="flex items-end gap-2">
              <SearchSubmitButton />
              {hasActiveSearchFilters(filters) ? (
                <Button asChild variant="ghost">
                  <Link href={`/orgs/${orgId}/search`}>Reset</Link>
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {filterError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-sm text-destructive">{filterError}</CardContent>
        </Card>
      ) : null}

      {!shouldSearch ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Enter a query to search across readable notes. Prefix with{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">#tagname</code> for
            exact tag search.
          </CardContent>
        </Card>
      ) : response && response.results.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 p-6 text-sm text-muted-foreground">
            <p>No readable notes matched this search.</p>
            <p>
              Current filters:{" "}
              <span className="font-medium text-foreground">{response.query.visibility}</span>
              {activeAuthor ? (
                <>
                  {" "}
                  ·{" "}
                  <span className="font-medium text-foreground">{activeAuthor.label}</span>
                </>
              ) : null}
              {response.query.tag ? (
                <>
                  {" "}
                  ·{" "}
                  <span className="font-medium text-foreground">#{response.query.tag}</span>
                </>
              ) : null}
            </p>
          </CardContent>
        </Card>
      ) : response ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <p>
              Showing page {response.page}
              {activeAuthor ? (
                <>
                  {" "}for{" "}
                  <span className="font-medium text-foreground">{activeAuthor.label}</span>
                </>
              ) : null}
            </p>
            <Link
              className="underline underline-offset-4"
              href={`/api/search?${new URLSearchParams({
                orgId,
                q: response.query.q,
                visibility: response.query.visibility,
                ...(response.query.authorId ? { authorId: response.query.authorId } : {}),
                ...(response.query.tag ? { tag: response.query.tag } : {}),
                ...(response.query.from ? { from: response.query.from } : {}),
                ...(response.query.to ? { to: response.query.to } : {}),
                page: String(response.page),
                pageSize: String(response.pageSize),
              }).toString()}`}
            >
              JSON
            </Link>
          </div>

          {response.results.map((result) => (
            <Card key={result.id} className="transition-shadow hover:shadow-md">
              <CardHeader className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                  <span>{result.visibility}</span>
                  <span>·</span>
                  <span>{result.authorName}</span>
                  <span>·</span>
                  <span>{formatUpdatedAt(result.updatedAt)}</span>
                </div>
                <div className="space-y-2">
                  <CardTitle>
                    <Link
                      href={`/orgs/${orgId}/notes/${result.id}`}
                      className="hover:underline"
                    >
                      {result.title}
                    </Link>
                  </CardTitle>
                  <CardDescription>
                    <SearchHighlight text={result.snippet} />
                  </CardDescription>
                </div>
              </CardHeader>
              {result.tags.length > 0 ? (
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-2">
                    {result.tags.map((tag) => (
                      <Link
                        key={tag}
                        href={buildSearchHref(orgId, { q: `#${tag}` }, 1)}
                        className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                      >
                        #{tag}
                      </Link>
                    ))}
                  </div>
                </CardContent>
              ) : null}
            </Card>
          ))}

          <div className="flex items-center justify-between">
            {response.page > 1 ? (
              <Button asChild variant="outline">
                <Link href={buildSearchHref(orgId, response.query, response.page - 1)}>
                  Previous
                </Link>
              </Button>
            ) : (
              <div />
            )}

            {response.hasNextPage ? (
              <Button asChild variant="outline">
                <Link href={buildSearchHref(orgId, response.query, response.page + 1)}>
                  Next
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
