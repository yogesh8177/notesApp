/**
 * Permission matrix for GET /api/graph/node/[type]/[id]
 *
 * Axes tested:
 *   - Authentication: unauthenticated → 401
 *   - orgId presence: missing → 422 (VALIDATION)
 *   - Org membership: non-member → 403, all roles (viewer/member/admin/owner) → 200
 *   - Cross-org: member of orgA querying with orgB → 403
 *   - Infrastructure: Neo4j unavailable → 503, node not found → 404
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { GraphNodeType } from "@/lib/graph/types";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/org", () => ({ getMembership: vi.fn() }));
vi.mock("@/lib/graph/client", () => ({ getDriver: vi.fn(), ensureIndexes: vi.fn() }));
vi.mock("@/lib/graph/queries", () => ({ getNodeNeighborhood: vi.fn(), isStale: vi.fn() }));
vi.mock("@/lib/graph/sync", () => ({ syncNode: vi.fn() }));
vi.mock("@/lib/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { GET } from "@/app/api/graph/node/[type]/[id]/route";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/auth/org";
import { getDriver, ensureIndexes } from "@/lib/graph/client";
import { getNodeNeighborhood, isStale } from "@/lib/graph/queries";
import { syncNode } from "@/lib/graph/sync";

const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_B = "bbbbbbbb-0000-0000-0000-000000000002";
const USER_ID = "user-0000-0000-0000-000000000001";
const NOTE_ID = "note-0000-0000-0000-000000000001";

const STUB_GRAPH = {
  nodes: [{ id: NOTE_ID, type: "Note" as GraphNodeType, label: "Test", properties: { orgId: ORG_A } }],
  links: [],
  centerNodeId: NOTE_ID,
};

function makeReq(orgId?: string, extra?: Record<string, string>) {
  const params = new URLSearchParams({ ...(orgId ? { orgId } : {}), ...extra });
  return new NextRequest(`http://localhost/api/graph/node/Note/${NOTE_ID}?${params}`);
}

function makeParams(type = "Note", id = NOTE_ID) {
  return { params: Promise.resolve({ type, id }) };
}

function mockAuthed(userId = USER_ID) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
  } as never);
}

function mockAnon() {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null } }) },
  } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ensureIndexes).mockResolvedValue(undefined);
  vi.mocked(getDriver).mockReturnValue({} as never);
  vi.mocked(isStale).mockReturnValue(false);
  vi.mocked(getNodeNeighborhood).mockResolvedValue(STUB_GRAPH);
  vi.mocked(syncNode).mockResolvedValue(undefined); // must return a Promise so .catch() works
});

describe("GET /api/graph/node/[type]/[id]", () => {
  describe("authentication", () => {
    it("returns 401 when unauthenticated", async () => {
      mockAnon();
      const res = await GET(makeReq(ORG_A), makeParams());
      expect(res.status).toBe(401);
    });
  });

  describe("input validation", () => {
    it("returns 422 when orgId is missing", async () => {
      mockAuthed();
      const res = await GET(makeReq(undefined), makeParams());
      expect(res.status).toBe(422);
    });

    it("returns 422 when orgId is not a valid UUID", async () => {
      mockAuthed();
      const res = await GET(makeReq("not-a-uuid"), makeParams());
      expect(res.status).toBe(422);
    });

    it("returns 422 for unknown node type", async () => {
      mockAuthed();
      vi.mocked(getMembership).mockResolvedValue({ role: "member" });
      const res = await GET(makeReq(ORG_A), makeParams("InvalidType"));
      expect(res.status).toBe(422);
    });
  });

  describe("org membership gate", () => {
    it("returns 403 when user is not a member of the requested org", async () => {
      mockAuthed();
      vi.mocked(getMembership).mockResolvedValue(null as never);
      const res = await GET(makeReq(ORG_A), makeParams());
      expect(res.status).toBe(403);
      expect(vi.mocked(getMembership)).toHaveBeenCalledWith(ORG_A, USER_ID);
    });

    it("cross-org: member of orgA cannot query with orgB", async () => {
      mockAuthed();
      vi.mocked(getMembership).mockImplementation(async (orgId) =>
        orgId === ORG_B ? (null as never) : { role: "viewer" as const }
      );
      const res = await GET(makeReq(ORG_B), makeParams());
      expect(res.status).toBe(403);
    });
  });

  describe("role visibility matrix — all roles can read graph data", () => {
    const roles = ["viewer", "member", "admin", "owner"] as const;

    for (const role of roles) {
      it(`${role} → 200`, async () => {
        mockAuthed();
        vi.mocked(getMembership).mockResolvedValue({ role });
        const res = await GET(makeReq(ORG_A), makeParams());
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.data.centerNodeId).toBe(NOTE_ID);
      });
    }
  });

  describe("infrastructure degradation", () => {
    it("returns 503 when Neo4j driver is unavailable", async () => {
      mockAuthed();
      vi.mocked(getMembership).mockResolvedValue({ role: "member" });
      vi.mocked(getDriver).mockReturnValue(null);
      const res = await GET(makeReq(ORG_A), makeParams());
      expect(res.status).toBe(503);
    });

    it("returns 404 when node is not found in Neo4j even after sync", async () => {
      mockAuthed();
      vi.mocked(getMembership).mockResolvedValue({ role: "member" });
      vi.mocked(getNodeNeighborhood).mockResolvedValue(null);
      const res = await GET(makeReq(ORG_A), makeParams());
      expect(res.status).toBe(404);
    });
  });

  describe("orgId is threaded into the graph query", () => {
    it("passes orgId to getNodeNeighborhood so traversal is org-scoped", async () => {
      mockAuthed();
      vi.mocked(getMembership).mockResolvedValue({ role: "member" });
      await GET(makeReq(ORG_A), makeParams());
      expect(vi.mocked(getNodeNeighborhood)).toHaveBeenCalledWith(
        "Note",
        NOTE_ID,
        expect.any(Number),
        expect.any(Number),
        expect.objectContaining({ orgId: ORG_A })
      );
    });
  });
});
