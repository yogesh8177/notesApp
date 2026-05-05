/**
 * Verifies that updateNote is a no-op when nothing changed.
 *
 * The guard lives in crud.ts: if title/content/visibility/tags all match the
 * current saved state, the function returns early without touching the DB.
 * We confirm this by asserting db.transaction is never called.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/client", () => ({ db: { select: vi.fn(), transaction: vi.fn() } }));
vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/log/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth/permissions", () => ({
  assertCanWriteNote: vi.fn().mockResolvedValue(undefined),
  assertCanReadNote:  vi.fn().mockResolvedValue(undefined),
  getNotePermission:  vi.fn(),
}));
vi.mock("@/lib/graph/queue", () => ({
  enqueueSync: vi.fn(),
  enqueueDelete: vi.fn(),
}));

// Mock queries without importOriginal to avoid auth/session → supabase → env chain.
// normalizeTags is a pure function — inline its logic here.
vi.mock("@/lib/notes/queries", () => ({
  normalizeTags: (values: string[]) =>
    Array.from(new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean))).slice(0, 20),
  ROLE_RANK: { owner: 4, admin: 3, member: 2, viewer: 1 },
  requireMemberRole: vi.fn().mockResolvedValue("member"),
  loadTagsForNotes:  vi.fn(),
  loadShares:        vi.fn().mockResolvedValue([]),
  loadHistory:       vi.fn().mockResolvedValue([]),
  listOrgMembers:    vi.fn().mockResolvedValue([]),
  loadShareCounts:   vi.fn().mockResolvedValue(new Map()),
  insertVersion:     vi.fn().mockResolvedValue(undefined),
  ensureTags:        vi.fn().mockResolvedValue(undefined),
  excerpt:           (v: string) => v.slice(0, 180),
}));

import { db } from "@/lib/db/client";
import { updateNote } from "@/lib/notes/crud";
import { getNotePermission } from "@/lib/auth/permissions";
import { loadTagsForNotes } from "@/lib/notes/queries";

const NOTE_ID = "note-0000-0000-0000-000000000001";
const USER_ID = "user-0000-0000-0000-000000000001";
const ORG_ID  = "org--0000-0000-0000-000000000001";

const BASE_PERMISSIONS = {
  canRead: true, canWrite: true, canShare: true, canDelete: true,
};

const BASE_NOTE_ROW = {
  id: NOTE_ID,
  orgId: ORG_ID,
  authorId: USER_ID,
  title: "Hello",
  content: "World",
  visibility: "org",
  currentVersion: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  authorEmail: "a@b.com",
  authorDisplayName: null,
};

// Build a chainable drizzle mock that resolves `rows` at .limit().
function makeDbChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from      = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.leftJoin  = vi.fn().mockReturnValue(chain);
  chain.where     = vi.fn().mockReturnValue(chain);
  chain.limit     = vi.fn().mockResolvedValue(rows);
  vi.mocked(db.select).mockReturnValue(chain as ReturnType<typeof db.select>);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(db.transaction).mockResolvedValue(undefined as never);
  makeDbChain([BASE_NOTE_ROW]);
  vi.mocked(getNotePermission).mockResolvedValue(BASE_PERMISSIONS);
  vi.mocked(loadTagsForNotes).mockResolvedValue(new Map([[NOTE_ID, ["alpha", "beta"]]]));
});

describe("updateNote — no-op guard", () => {
  it("skips db.transaction when nothing changed", async () => {
    await updateNote(
      NOTE_ID,
      { title: "Hello", content: "World", visibility: "org", tags: ["alpha", "beta"] },
      USER_ID,
    );
    expect(vi.mocked(db.transaction)).not.toHaveBeenCalled();
  });

  it("skips db.transaction when tags are same in different order", async () => {
    await updateNote(
      NOTE_ID,
      { title: "Hello", content: "World", visibility: "org", tags: ["beta", "alpha"] },
      USER_ID,
    );
    expect(vi.mocked(db.transaction)).not.toHaveBeenCalled();
  });

  it("skips db.transaction when tags differ only by whitespace or case", async () => {
    await updateNote(
      NOTE_ID,
      { title: "Hello", content: "World", visibility: "org", tags: [" Alpha ", "BETA"] },
      USER_ID,
    );
    expect(vi.mocked(db.transaction)).not.toHaveBeenCalled();
  });

  it("returns the current note on a no-op without bumping the version", async () => {
    const result = await updateNote(
      NOTE_ID,
      { title: "Hello", content: "World", visibility: "org", tags: ["alpha", "beta"] },
      USER_ID,
    );
    expect(result.currentVersion).toBe(1);
    expect(result.title).toBe("Hello");
  });

  it("calls db.transaction when the title changes", async () => {
    await updateNote(
      NOTE_ID,
      { title: "New title", content: "World", visibility: "org", tags: ["alpha", "beta"] },
      USER_ID,
    ).catch(() => {});
    expect(vi.mocked(db.transaction)).toHaveBeenCalled();
  });

  it("calls db.transaction when the content changes", async () => {
    await updateNote(
      NOTE_ID,
      { title: "Hello", content: "Different body", visibility: "org", tags: ["alpha", "beta"] },
      USER_ID,
    ).catch(() => {});
    expect(vi.mocked(db.transaction)).toHaveBeenCalled();
  });

  it("calls db.transaction when visibility changes", async () => {
    await updateNote(
      NOTE_ID,
      { title: "Hello", content: "World", visibility: "private", tags: ["alpha", "beta"] },
      USER_ID,
    ).catch(() => {});
    expect(vi.mocked(db.transaction)).toHaveBeenCalled();
  });

  it("calls db.transaction when a tag is added", async () => {
    await updateNote(
      NOTE_ID,
      { title: "Hello", content: "World", visibility: "org", tags: ["alpha", "beta", "gamma"] },
      USER_ID,
    ).catch(() => {});
    expect(vi.mocked(db.transaction)).toHaveBeenCalled();
  });

  it("calls db.transaction when a tag is removed", async () => {
    await updateNote(
      NOTE_ID,
      { title: "Hello", content: "World", visibility: "org", tags: ["alpha"] },
      USER_ID,
    ).catch(() => {});
    expect(vi.mocked(db.transaction)).toHaveBeenCalled();
  });
});
