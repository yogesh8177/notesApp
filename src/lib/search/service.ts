import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  memberships,
  noteShares,
  noteTags,
  notes,
  tags,
  users,
} from "@/lib/db/schema";
import { db } from "@/lib/db/client";
import { audit } from "@/lib/log/audit";
import type {
  SearchFacetOption,
  SearchRequest,
  SearchResponse,
  SearchResultItem,
} from "./contracts";

/** Caller identity — role is NOT used here; visibility is user-relative. */
export interface SearchViewer {
  orgId: string;
  userId: string;
}

interface SearchRow {
  id: string;
  title: string;
  snippet: string;
  visibility: SearchResultItem["visibility"];
  authorId: string;
  authorName: string;
  updatedAt: Date | string;
  score: number;
  tags: string[] | null;
}

/**
 * Visibility predicate for notes.
 *
 * A note is readable when:
 *   - The viewer is the author (any visibility), OR
 *   - visibility = 'org' (all org members can read), OR
 *   - visibility = 'shared' AND a note_shares row exists for the viewer.
 *
 * Importantly: org admin/owner role does NOT bypass this. Private notes
 * authored by others are never returned regardless of the caller's role.
 * This is an app-level guard; RLS on the DB enforces the same rules.
 */
function buildReadablePredicate(viewer: SearchViewer): SQL<unknown> {
  return sql`
    (
      ${notes.authorId} = ${viewer.userId}
      OR ${notes.visibility} = 'org'
      OR (
        ${notes.visibility} = 'shared'
        AND EXISTS (
          SELECT 1
          FROM ${noteShares}
          WHERE ${noteShares.noteId} = ${notes.id}
            AND ${noteShares.sharedWithUserId} = ${viewer.userId}
        )
      )
    )
  `;
}

function buildBaseConditions(input: SearchRequest, viewer: SearchViewer): SQL<unknown>[] {
  const conditions: SQL<unknown>[] = [
    eq(notes.orgId, input.orgId),
    isNull(notes.deletedAt),
    buildReadablePredicate(viewer),
  ];

  if (input.visibility !== "all") {
    conditions.push(eq(notes.visibility, input.visibility));
  }
  if (input.authorId) {
    conditions.push(eq(notes.authorId, input.authorId));
  }
  if (input.from) {
    conditions.push(sql`${notes.updatedAt}::date >= ${input.from}`);
  }
  if (input.to) {
    conditions.push(sql`${notes.updatedAt}::date <= ${input.to}`);
  }
  // Tag filter: EXISTS subquery in WHERE so it applies before GROUP BY + LIMIT.
  // Using HAVING instead would evaluate post-aggregation and break pagination
  // when RLS (or the visibility predicate) denies rows inside the group.
  if (input.tag) {
    conditions.push(
      sql`EXISTS (
        SELECT 1
        FROM ${noteTags} nt
        JOIN ${tags} t ON t.id = nt.tag_id
        WHERE nt.note_id = ${notes.id}
          AND lower(t.name) = lower(${input.tag})
          AND t.org_id = ${input.orgId}
      )`,
    );
  }

  return conditions;
}

function toResultItem(row: SearchRow): SearchResultItem {
  return {
    id: row.id,
    title: row.title,
    snippet: row.snippet,
    visibility: row.visibility,
    authorId: row.authorId,
    authorName: row.authorName,
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : new Date(row.updatedAt).toISOString(),
    score: Number(row.score),
    tags: Array.isArray(row.tags) ? row.tags.filter(Boolean) : [],
  };
}

export async function listSearchAuthors(orgId: string): Promise<SearchFacetOption[]> {
  const authorName = sql<string>`coalesce(${users.displayName}, ${users.email})`;

  return db
    .select({
      value: users.id,
      label: authorName,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .orderBy(asc(authorName));
}

export async function listSearchTags(orgId: string): Promise<SearchFacetOption[]> {
  return db
    .select({
      value: tags.name,
      label: tags.name,
    })
    .from(tags)
    .where(eq(tags.orgId, orgId))
    .orderBy(asc(tags.name));
}

/**
 * Full-text (tsvector) + pg_trgm fallback query.
 * Ranked by: ts_rank_cd * 0.75 + title/content similarity * 0.2 + tag similarity * 0.05.
 * Tag filter is applied in WHERE (not HAVING) so it commutes with LIMIT/OFFSET.
 */
async function searchByFts(
  input: SearchRequest,
  viewer: SearchViewer,
): Promise<SearchResponse> {
  const pageSize = input.pageSize;
  const offset = (input.page - 1) * pageSize;

  const tsQuery = sql`websearch_to_tsquery('english', ${input.q})`;
  const titleSimilarity = sql<number>`similarity(lower(${notes.title}), lower(${input.q}))`;
  const contentSimilarity = sql<number>`similarity(lower(${notes.content}), lower(${input.q}))`;
  const tagSimilarity = sql<number>`coalesce(max(similarity(lower(${tags.name}), lower(${input.q}))), 0)`;
  const fullTextRank = sql<number>`ts_rank_cd(${notes.searchVector}, ${tsQuery})`;
  const score = sql<number>`(
    (${fullTextRank} * 0.75)
    + (greatest(${titleSimilarity}, ${contentSimilarity}) * 0.2)
    + (${tagSimilarity} * 0.05)
  )`;
  const snippet = sql<string>`
    case
      when ${notes.searchVector} @@ ${tsQuery} then
        ts_headline(
          'english',
          coalesce(${notes.content}, ''),
          ${tsQuery},
          'StartSel=<<, StopSel=>>, MaxFragments=2, MaxWords=18, MinWords=8'
        )
      else left(coalesce(${notes.content}, ''), 180)
    end
  `;
  const aggregatedTags = sql<string[]>`array_remove(array_agg(distinct ${tags.name}), null)`;

  // Relevance gate: require either an FTS hit or a fuzzy title/content match.
  const relevanceHaving = sql<boolean>`
    ${notes.searchVector} @@ ${tsQuery}
    OR ${titleSimilarity} >= 0.12
    OR ${contentSimilarity} >= 0.08
    OR coalesce(bool_or(similarity(lower(${tags.name}), lower(${input.q})) >= 0.2), false)
  `;

  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      snippet,
      visibility: notes.visibility,
      authorId: notes.authorId,
      authorName: sql<string>`coalesce(${users.displayName}, ${users.email})`,
      updatedAt: notes.updatedAt,
      score,
      tags: aggregatedTags,
    })
    .from(notes)
    .innerJoin(users, eq(users.id, notes.authorId))
    .leftJoin(noteTags, eq(noteTags.noteId, notes.id))
    .leftJoin(tags, eq(tags.id, noteTags.tagId))
    .where(and(...buildBaseConditions(input, viewer)))
    .groupBy(
      notes.id,
      notes.title,
      notes.content,
      notes.searchVector,
      notes.visibility,
      notes.authorId,
      notes.updatedAt,
      users.displayName,
      users.email,
    )
    .having(relevanceHaving)
    .orderBy(desc(score), desc(notes.updatedAt), desc(notes.id))
    .limit(pageSize + 1)
    .offset(offset);

  const hasNextPage = rows.length > pageSize;

  return {
    orgId: input.orgId,
    page: input.page,
    pageSize,
    hasNextPage,
    query: {
      q: input.q,
      visibility: input.visibility,
      authorId: input.authorId,
      tag: input.tag,
      from: input.from,
      to: input.to,
      page: input.page,
      pageSize: input.pageSize,
    },
    results: (rows.slice(0, pageSize) as SearchRow[]).map(toResultItem),
  };
}

/**
 * Filter-only browse: no text query, just apply the base conditions (tag, author,
 * visibility, date range) and sort by recency. Used when the user submits filters
 * without a search term.
 */
async function browseFiltered(
  input: SearchRequest,
  viewer: SearchViewer,
): Promise<SearchResponse> {
  const pageSize = input.pageSize;
  const offset = (input.page - 1) * pageSize;
  const aggregatedTags = sql<string[]>`array_remove(array_agg(distinct ${tags.name}), null)`;

  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      snippet: sql<string>`left(coalesce(${notes.content}, ''), 180)`,
      visibility: notes.visibility,
      authorId: notes.authorId,
      authorName: sql<string>`coalesce(${users.displayName}, ${users.email})`,
      updatedAt: notes.updatedAt,
      score: sql<number>`0`,
      tags: aggregatedTags,
    })
    .from(notes)
    .innerJoin(users, eq(users.id, notes.authorId))
    .leftJoin(noteTags, eq(noteTags.noteId, notes.id))
    .leftJoin(tags, eq(tags.id, noteTags.tagId))
    .where(and(...buildBaseConditions(input, viewer)))
    .groupBy(
      notes.id,
      notes.title,
      notes.content,
      notes.visibility,
      notes.authorId,
      notes.updatedAt,
      users.displayName,
      users.email,
    )
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .limit(pageSize + 1)
    .offset(offset);

  const hasNextPage = rows.length > pageSize;

  return {
    orgId: input.orgId,
    page: input.page,
    pageSize,
    hasNextPage,
    query: {
      q: input.q,
      visibility: input.visibility,
      authorId: input.authorId,
      tag: input.tag,
      from: input.from,
      to: input.to,
      page: input.page,
      pageSize: input.pageSize,
    },
    results: (rows.slice(0, pageSize) as SearchRow[]).map(toResultItem),
  };
}

/**
 * Tag-prefix path: when `input.q` starts with `#`, strip the `#` and look up
 * notes by `note_tags.tag_id` instead of running FTS. This gives exact tag
 * search with correct pagination and no relevance ranking needed.
 */
async function searchByTag(
  tagName: string,
  input: SearchRequest,
  viewer: SearchViewer,
): Promise<SearchResponse> {
  const pageSize = input.pageSize;
  const offset = (input.page - 1) * pageSize;

  const emptyResponse: SearchResponse = {
    orgId: input.orgId,
    page: input.page,
    pageSize,
    hasNextPage: false,
    query: {
      q: input.q,
      visibility: input.visibility,
      authorId: input.authorId,
      tag: input.tag,
      from: input.from,
      to: input.to,
      page: input.page,
      pageSize: input.pageSize,
    },
    results: [],
  };

  const [tagRow] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.orgId, input.orgId), sql`lower(${tags.name}) = lower(${tagName})`))
    .limit(1);

  if (!tagRow) return emptyResponse;

  const baseConditions = buildBaseConditions(input, viewer);
  // The #tag query itself determines which notes to include — match by tag_id.
  baseConditions.push(
    sql`EXISTS (
      SELECT 1 FROM ${noteTags} nt2
      WHERE nt2.note_id = ${notes.id}
        AND nt2.tag_id = ${tagRow.id}
    )`,
  );

  const aggregatedTags = sql<string[]>`array_remove(array_agg(distinct ${tags.name}), null)`;

  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      snippet: sql<string>`left(coalesce(${notes.content}, ''), 180)`,
      visibility: notes.visibility,
      authorId: notes.authorId,
      authorName: sql<string>`coalesce(${users.displayName}, ${users.email})`,
      updatedAt: notes.updatedAt,
      score: sql<number>`0`,
      tags: aggregatedTags,
    })
    .from(notes)
    .innerJoin(users, eq(users.id, notes.authorId))
    .leftJoin(noteTags, eq(noteTags.noteId, notes.id))
    .leftJoin(tags, eq(tags.id, noteTags.tagId))
    .where(and(...baseConditions))
    .groupBy(
      notes.id,
      notes.title,
      notes.content,
      notes.visibility,
      notes.authorId,
      notes.updatedAt,
      users.displayName,
      users.email,
    )
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .limit(pageSize + 1)
    .offset(offset);

  const hasNextPage = rows.length > pageSize;

  return {
    ...emptyResponse,
    hasNextPage,
    results: (rows.slice(0, pageSize) as SearchRow[]).map(toResultItem),
  };
}

export async function searchNotes(
  input: SearchRequest,
  viewer: SearchViewer,
): Promise<SearchResponse> {
  if (input.orgId !== viewer.orgId) {
    throw new Error("Search org mismatch.");
  }

  const startedAt = Date.now();

  let result: SearchResponse;

  // No text query — run a filter-only browse sorted by recency.
  if (!input.q) {
    result = await browseFiltered(input, viewer);
  } else if (input.q.startsWith("#")) {
  // Tag-prefix path: "#tagname" → skip FTS, filter by note_tags.tag_id.
    const tagName = input.q.slice(1).trim();
    result = tagName
      ? await searchByTag(tagName, input, viewer)
      : { orgId: input.orgId, page: input.page, pageSize: input.pageSize, hasNextPage: false,
          query: { q: input.q, visibility: input.visibility, authorId: input.authorId,
            tag: input.tag, from: input.from, to: input.to, page: input.page, pageSize: input.pageSize },
          results: [] };
  } else {
    result = await searchByFts(input, viewer);
  }

  // Audit: log query (truncated), result count, latency. Never log note content.
  await audit({
    action: "search.execute",
    orgId: input.orgId,
    userId: viewer.userId,
    resourceType: "search",
    resourceId: input.orgId,
    metadata: {
      q: (input.q ?? "").slice(0, 256),
      resultCount: result.results.length,
      latencyMs: Date.now() - startedAt,
      page: input.page,
    },
  });

  return result;
}

export { type SearchFacetOption };
export function hasActiveSearchFilters(
  input: Partial<Pick<SearchRequest, "q" | "visibility" | "authorId" | "tag" | "from" | "to">>,
) {
  return Boolean(
    input.q ||
      (input.visibility && input.visibility !== "all") ||
      input.authorId ||
      input.tag ||
      input.from ||
      input.to,
  );
}
