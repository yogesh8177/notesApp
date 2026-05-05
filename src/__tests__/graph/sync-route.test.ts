/**
 * Permission matrix for POST /api/graph/sync
 *
 * Axes tested:
 *   - Authentication: unauthenticated → 401
 *   - Org membership: non-member → 403, member → 200
 *   - Cross-org: member of orgA posting orgB → 403
 *   - syncNode is called only when membership is confirmed
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/org", () => ({ getMembership: vi.fn() }));
vi.mock("@/lib/graph/client", () => ({ getDriver: vi.fn() }));
vi.mock("@/lib/graph/sync", () => ({ syncNode: vi.fn() }));
vi.mock("@/lib/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/log/audit", () => ({ audit: vi.fn() }));

import { POST } from "@/app/api/graph/sync/route";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/auth/org";
import { getDriver } from "@/lib/graph/client";
import { syncNode } from "@/lib/graph/sync";

const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_B = "bbbbbbbb-0000-0000-0000-000000000002";
const USER_ID = "user-0000-0000-0000-000000000001";
const NOTE_ID = "note-0000-0000-0000-000000000001";

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/graph/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
  vi.mocked(getDriver).mockReturnValue({} as never);
  vi.mocked(syncNode).mockResolvedValue(undefined);
});

describe("POST /api/graph/sync", () => {
  describe("authentication", () => {
    it("returns 401 when unauthenticated", async () => {
      mockAnon();
      const res = await POST(makeReq({ type: "Note", id: NOTE_ID, orgId: ORG_A }));
      expect(res.status).toBe(401);
      expect(vi.mocked(syncNode)).not.toHaveBeenCalled();
    });
  });

  describe("org membership gate", () => {
    it("returns 403 when user is not a member of the requested org", async () => {
      mockAuthed();
      vi.mocked(getMembership).mockResolvedValue(null as never);
      const res = await POST(makeReq({ type: "Note", id: NOTE_ID, orgId: ORG_A }));
      expect(res.status).toBe(403);
      expect(vi.mocked(syncNode)).not.toHaveBeenCalled();
    });

    it("cross-org: member of orgA cannot trigger sync for orgB", async () => {
      mockAuthed();
      vi.mocked(getMembership).mockImplementation(async (orgId) =>
        orgId === ORG_B ? (null as never) : { role: "member" as const }
      );
      const res = await POST(makeReq({ type: "Note", id: NOTE_ID, orgId: ORG_B }));
      expect(res.status).toBe(403);
      expect(vi.mocked(getMembership)).toHaveBeenCalledWith(ORG_B, USER_ID);
      expect(vi.mocked(syncNode)).not.toHaveBeenCalled();
    });
  });

  describe("successful sync", () => {
    it("allows a member to trigger sync for their own org", async () => {
      mockAuthed();
      vi.mocked(getMembership).mockResolvedValue({ role: "member" });
      const res = await POST(makeReq({ type: "Note", id: NOTE_ID, orgId: ORG_A }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(vi.mocked(syncNode)).toHaveBeenCalledWith("Note", NOTE_ID, ORG_A);
    });

    const roles = ["viewer", "member", "admin", "owner"] as const;
    for (const role of roles) {
      it(`${role} can trigger sync`, async () => {
        mockAuthed();
        vi.mocked(getMembership).mockResolvedValue({ role });
        const res = await POST(makeReq({ type: "Note", id: NOTE_ID, orgId: ORG_A }));
        expect(res.status).toBe(200);
      });
    }
  });

  describe("input validation", () => {
    it("returns 422 for missing orgId", async () => {
      mockAuthed();
      const res = await POST(makeReq({ type: "Note", id: NOTE_ID }));
      expect(res.status).toBe(422);
    });

    it("returns 422 for invalid node type", async () => {
      mockAuthed();
      const res = await POST(makeReq({ type: "Unknown", id: NOTE_ID, orgId: ORG_A }));
      expect(res.status).toBe(422);
    });
  });

  describe("infrastructure", () => {
    it("returns error when Neo4j driver is unavailable", async () => {
      mockAuthed();
      vi.mocked(getDriver).mockReturnValue(null);
      const res = await POST(makeReq({ type: "Note", id: NOTE_ID, orgId: ORG_A }));
      expect(res.status).not.toBe(200);
    });
  });
});
