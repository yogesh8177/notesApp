/**
 * Unit tests for getNotePermission and its assertCan* wrappers.
 *
 * db is mocked so the tests cover the permission logic itself, not Postgres.
 * Integration coverage of the full DB join lives in the integration suite.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/client", () => ({ db: { select: vi.fn() } }));
vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/log/audit", () => ({ audit: vi.fn() }));

import { db } from "@/lib/db/client";
import {
  getNotePermission,
  assertCanReadNote,
  assertCanWriteNote,
  assertCanShareNote,
  PermissionError,
} from "@/lib/auth/permissions";

const NOTE_ID = "note-0000-0000-0000-000000000001";
const USER_ID = "user-0000-0000-0000-000000000001";
const ORG_ID  = "org--0000-0000-0000-000000000001";

// Build a chainable drizzle mock that resolves to `rows` at .limit().
function mockDb(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from      = vi.fn().mockReturnValue(chain);
  chain.leftJoin  = vi.fn().mockReturnValue(chain);
  chain.where     = vi.fn().mockReturnValue(chain);
  chain.limit     = vi.fn().mockResolvedValue(rows);
  vi.mocked(db.select).mockReturnValue(chain as ReturnType<typeof db.select>);
}

type RowOverrides = {
  authorId?: string;
  visibility?: "private" | "org" | "shared";
  deletedAt?: Date | null;
  role?: "owner" | "admin" | "member" | "viewer" | null;
  sharePerm?: "view" | "edit" | null;
};

function makeRow(o: RowOverrides = {}) {
  return [{
    note: {
      id: NOTE_ID,
      orgId: ORG_ID,
      authorId:   o.authorId   ?? "other-user",
      visibility: o.visibility ?? "org",
      deletedAt:  o.deletedAt  ?? null,
    },
    // Use `in` check so callers can explicitly pass null (non-member).
    role:      "role"      in o ? o.role      : "member",
    sharePerm: "sharePerm" in o ? o.sharePerm : null,
  }];
}

beforeEach(() => vi.resetAllMocks());

describe("getNotePermission", () => {
  describe("not found / deleted", () => {
    it("returns all-false with reason=not-found when note row is absent", async () => {
      mockDb([]);
      const p = await getNotePermission(NOTE_ID, USER_ID);
      expect(p).toEqual({ canRead: false, canWrite: false, canShare: false, canDelete: false, reason: "not-found" });
    });

    it("returns all-false with reason=not-found when note is soft-deleted", async () => {
      mockDb(makeRow({ deletedAt: new Date() }));
      const p = await getNotePermission(NOTE_ID, USER_ID);
      expect(p).toEqual({ canRead: false, canWrite: false, canShare: false, canDelete: false, reason: "not-found" });
    });
  });

  describe("private notes", () => {
    it("author can read/write/share/delete their own private note", async () => {
      mockDb(makeRow({ visibility: "private", authorId: USER_ID, role: "member" }));
      const p = await getNotePermission(NOTE_ID, USER_ID);
      expect(p.canRead).toBe(true);
      expect(p.canWrite).toBe(true);
      expect(p.canShare).toBe(true);
      expect(p.canDelete).toBe(true);
    });

    it("non-author org member cannot read a private note", async () => {
      mockDb(makeRow({ visibility: "private", authorId: "other", role: "member" }));
      const p = await getNotePermission(NOTE_ID, USER_ID);
      expect(p.canRead).toBe(false);
      expect(p.reason).toBe("forbidden");
    });

    it("admin can read a private note they did not author", async () => {
      mockDb(makeRow({ visibility: "private", authorId: "other", role: "admin" }));
      const p = await getNotePermission(NOTE_ID, USER_ID);
      expect(p.canRead).toBe(true);
      expect(p.canWrite).toBe(true);
    });
  });

  describe("org-visible notes", () => {
    it("org member can read but not write without a share", async () => {
      mockDb(makeRow({ visibility: "org", role: "member" }));
      const p = await getNotePermission(NOTE_ID, USER_ID);
      expect(p.canRead).toBe(true);
      expect(p.canWrite).toBe(false);
      expect(p.canShare).toBe(false);
      expect(p.canDelete).toBe(false);
    });

    it("author of an org note can read and write", async () => {
      mockDb(makeRow({ visibility: "org", authorId: USER_ID, role: "member" }));
      const p = await getNotePermission(NOTE_ID, USER_ID);
      expect(p.canRead).toBe(true);
      expect(p.canWrite).toBe(true);
      expect(p.canShare).toBe(true);
      expect(p.canDelete).toBe(true);
    });

    it("member with an edit share can write", async () => {
      mockDb(makeRow({ visibility: "org", role: "member", sharePerm: "edit" }));
      const p = await getNotePermission(NOTE_ID, USER_ID);
      expect(p.canRead).toBe(true);
      expect(p.canWrite).toBe(true);
    });

    it("admin can write even without being the author", async () => {
      mockDb(makeRow({ visibility: "org", role: "admin" }));
      const p = await getNotePermission(NOTE_ID, USER_ID);
      expect(p.canWrite).toBe(true);
      expect(p.canShare).toBe(true);
      expect(p.canDelete).toBe(true);
    });

    it("non-member cannot read an org note", async () => {
      mockDb(makeRow({ visibility: "org", role: null }));
      const p = await getNotePermission(NOTE_ID, USER_ID);
      expect(p.canRead).toBe(false);
    });

    it("viewer role can read but not write", async () => {
      mockDb(makeRow({ visibility: "org", role: "viewer" }));
      const p = await getNotePermission(NOTE_ID, USER_ID);
      expect(p.canRead).toBe(true);
      expect(p.canWrite).toBe(false);
    });
  });

  describe("shared notes", () => {
    it("author of a shared note can always read", async () => {
      mockDb(makeRow({ visibility: "shared", authorId: USER_ID, role: null }));
      const p = await getNotePermission(NOTE_ID, USER_ID);
      expect(p.canRead).toBe(true);
    });

    it("non-author with no share cannot read", async () => {
      mockDb(makeRow({ visibility: "shared", role: null, sharePerm: null }));
      const p = await getNotePermission(NOTE_ID, USER_ID);
      expect(p.canRead).toBe(false);
    });

    it("non-author with view share can read but not write", async () => {
      mockDb(makeRow({ visibility: "shared", role: null, sharePerm: "view" }));
      const p = await getNotePermission(NOTE_ID, USER_ID);
      expect(p.canRead).toBe(true);
      expect(p.canWrite).toBe(false);
    });

    it("non-author with edit share can read and write", async () => {
      mockDb(makeRow({ visibility: "shared", role: null, sharePerm: "edit" }));
      const p = await getNotePermission(NOTE_ID, USER_ID);
      expect(p.canRead).toBe(true);
      expect(p.canWrite).toBe(true);
    });
  });
});

describe("assertCanReadNote", () => {
  it("resolves when user can read", async () => {
    mockDb(makeRow({ visibility: "org", role: "member" }));
    await expect(assertCanReadNote(NOTE_ID, USER_ID)).resolves.toBeUndefined();
  });

  it("throws PermissionError when user cannot read", async () => {
    mockDb([]);
    await expect(assertCanReadNote(NOTE_ID, USER_ID)).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("assertCanWriteNote", () => {
  it("resolves when user can write", async () => {
    mockDb(makeRow({ visibility: "org", authorId: USER_ID, role: "member" }));
    await expect(assertCanWriteNote(NOTE_ID, USER_ID)).resolves.toBeUndefined();
  });

  it("throws PermissionError when member has only view share", async () => {
    mockDb(makeRow({ visibility: "org", role: "member", sharePerm: "view" }));
    await expect(assertCanWriteNote(NOTE_ID, USER_ID)).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("assertCanShareNote", () => {
  it("resolves for the note author", async () => {
    mockDb(makeRow({ visibility: "org", authorId: USER_ID, role: "member" }));
    await expect(assertCanShareNote(NOTE_ID, USER_ID)).resolves.toBeUndefined();
  });

  it("throws PermissionError for a non-author member", async () => {
    mockDb(makeRow({ visibility: "org", role: "member" }));
    await expect(assertCanShareNote(NOTE_ID, USER_ID)).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("PermissionError", () => {
  it("has the expected shape", () => {
    const e = new PermissionError("forbidden", "note:write", NOTE_ID);
    expect(e.code).toBe("PERMISSION_DENIED");
    expect(e.name).toBe("PermissionError");
    expect(e.action).toBe("note:write");
    expect(e.resourceId).toBe(NOTE_ID);
    expect(e.message).toContain("note:write");
  });
});
