/**
 * Unit tests for GET /api/search.
 * Auth via mocked session; search service fully mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/db/client",       () => ({ db: { select: vi.fn() } }));
vi.mock("@/lib/log",             () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/log/audit",       () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth/session",    () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth/org",        () => ({ getMembership: vi.fn(), requireOrgRole: vi.fn(), ForbiddenError: class ForbiddenError extends Error {} }));
vi.mock("@/lib/search/service",  () => ({ searchNotes: vi.fn() }));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/search/route";
import { getCurrentUser } from "@/lib/auth/session";
import { getMembership } from "@/lib/auth/org";
import { searchNotes } from "@/lib/search/service";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID  = "22222222-2222-2222-2222-222222222222";

function authed(userId = USER_ID) {
  vi.mocked(getCurrentUser).mockResolvedValue({ id: userId, email: "a@b.com" } as never);
}
function anon() {
  vi.mocked(getCurrentUser).mockResolvedValue(null);
}

function searchReq(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/search");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString());
}

const STUB_RESULT = { results: [], total: 0, facets: {} };

beforeEach(() => vi.resetAllMocks());

describe("GET /api/search", () => {
  it("returns 401 when unauthenticated", async () => {
    anon();
    const res = await GET(searchReq({ orgId: ORG_ID, q: "hello" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not an org member", async () => {
    authed();
    vi.mocked(getMembership).mockResolvedValue(null as never);
    const res = await GET(searchReq({ orgId: ORG_ID, q: "hello" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when orgId is missing", async () => {
    authed();
    const res = await GET(searchReq({ q: "hello" }));
    expect(res.status).toBe(400);
  });

  it("returns 200 with search results when authed and member", async () => {
    authed();
    vi.mocked(getMembership).mockResolvedValue("member" as never);
    vi.mocked(searchNotes).mockResolvedValue(STUB_RESULT as never);
    const res = await GET(searchReq({ orgId: ORG_ID, q: "hello" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([]);
  });

  it("passes the authenticated userId to searchNotes", async () => {
    authed("specific-user");
    vi.mocked(getMembership).mockResolvedValue("member" as never);
    vi.mocked(searchNotes).mockResolvedValue(STUB_RESULT as never);
    await GET(searchReq({ orgId: ORG_ID, q: "hello" }));
    expect(vi.mocked(searchNotes)).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: ORG_ID, userId: "specific-user" },
    );
  });
});
