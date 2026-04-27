import { z } from "zod";

export const SEARCH_VISIBILITIES = ["all", "private", "org", "shared"] as const;

const searchBaseSchema = z.object({
  orgId: z.string().uuid(),
  q: z.string().trim().min(1).max(200).optional(),
  visibility: z.enum(SEARCH_VISIBILITIES).default("all"),
  authorId: z.string().uuid().optional(),
  tag: z.string().trim().min(1).max(64).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

function validateDateRange(
  value: { from?: string; to?: string },
  ctx: z.RefinementCtx,
) {
  if (value.from && value.to && value.from > value.to) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "`from` must be on or before `to`.",
      path: ["from"],
    });
  }
}

export const searchFiltersSchema = searchBaseSchema.superRefine((value, ctx) => {
  validateDateRange(value, ctx);
});

// q is optional — filter-only searches (tag, author, date) are valid without a text query.
export const searchRequestSchema = searchBaseSchema.superRefine((value, ctx) => {
  validateDateRange(value, ctx);
});

export type SearchVisibilityFilter = (typeof SEARCH_VISIBILITIES)[number];
export type SearchFilters = z.infer<typeof searchFiltersSchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;

export interface SearchResultItem {
  id: string;
  title: string;
  snippet: string;
  visibility: Exclude<SearchVisibilityFilter, "all">;
  authorId: string;
  authorName: string;
  updatedAt: string;
  score: number;
  tags: string[];
}

export interface SearchResponse {
  orgId: string;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
  query: Omit<SearchRequest, "orgId">;
  results: SearchResultItem[];
}

export interface SearchFacetOption {
  value: string;
  label: string;
}

type SearchParamRecord = Record<string, string | string[] | undefined>;

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    value = value[0];
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeParams(source: SearchParamRecord | URLSearchParams, orgId: string) {
  const read = (key: string) =>
    source instanceof URLSearchParams ? pickFirst(source.get(key) ?? undefined) : pickFirst(source[key]);

  return {
    orgId,
    q: read("q"),
    visibility: read("visibility"),
    authorId: read("authorId"),
    tag: read("tag"),
    from: read("from"),
    to: read("to"),
    page: read("page"),
    pageSize: read("pageSize"),
  };
}

export function parseSearchFilters(
  source: SearchParamRecord | URLSearchParams,
  orgId: string,
): SearchFilters {
  return searchFiltersSchema.parse(normalizeParams(source, orgId));
}

export function parseSearchRequest(
  source: SearchParamRecord | URLSearchParams,
  orgId: string,
): SearchRequest {
  return searchRequestSchema.parse(normalizeParams(source, orgId));
}

export function safeParseSearchFilters(
  source: SearchParamRecord | URLSearchParams,
  orgId: string,
): { data: SearchFilters; error: string | null } {
  const parsed = searchFiltersSchema.safeParse(normalizeParams(source, orgId));
  if (parsed.success) {
    return { data: parsed.data, error: null };
  }

  return {
    data: {
      orgId,
      visibility: "all",
      page: 1,
      pageSize: 20,
    },
    error: parsed.error.issues[0]?.message ?? "Invalid search filters.",
  };
}
