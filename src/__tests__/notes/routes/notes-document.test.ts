/**
 * Unit tests for GET/PATCH/DELETE /api/notes/[noteId]
 * and GET/POST /api/notes/[noteId]/shares.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/db/client",       () => ({ db: { select: vi.fn(), insert: vi.fn(), transaction: vi.fn() } }));
vi.mock("@/lib/log",             () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/log/audit",       () => ({ audit: vi.fn() }));
vi.mock("@/lib/graph/queue",     () => ({ enqueueSync: vi.fn(), enqueueDelete: vi.fn() }));
vi.mock("@/lib/notes/crud", () => ({
  listNotesForUser:     vi.fn(),
  createNote:           vi.fn(),
  getNoteDetailForUser: vi.fn(),
  updateNote:           vi.fn(),
  deleteNote:           vi.fn(),
}));
vi.mock("@/lib/notes/shares",  () => ({ upsertNoteShare: vi.fn(), removeNoteShare: vi.fn() }));
vi.mock("@/lib/notes/history", () => ({ getNoteHistory: vi.fn() }));

import {
  GET as noteGet,
  PATCH as notePatch,
  DELETE as noteDelete,
} from "@/app/api/notes/[noteId]/route";
import {
  GET as sharesGet,
  POST as sharesPost,
} from "@/app/api/notes/[noteId]/shares/route";
import { createClient } from "@/lib/supabase/server";
import { getNoteDetailForUser, updateNote, deleteNote } from "@/lib/notes/crud";
import { upsertNoteShare } from "@/lib/notes/shares";
import { NotesError } from "@/lib/notes/errors";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID  = "22222222-2222-2222-2222-222222222222";
const NOTE_ID = "33333333-3333-3333-3333-333333333333";

function authed(userId = USER_ID) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  } as never);
}
function anon() {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: { message: "no session" } }) },
  } as never);
}

function params(noteId = NOTE_ID) {
  return { params: Promise.resolve({ noteId }) };
}

const STUB_DETAIL = {
  note: {
    id: NOTE_ID, orgId: ORG_ID, title: "T", content: "C",
    visibility: "org", currentVersion: 1,
    createdAt: new Date(), updatedAt: new Date(),
    author: { id: USER_ID, email: "a@b.com", displayName: null },
    tags: [], shares: [], history: [],
    permissions: { canRead: true, canWrite: true, canShare: true, canDelete: true },
  },
  members: [],
};

beforeEach(() => vi.resetAllMocks());

// ---------------------------------------------------------------------------
// GET /api/notes/[noteId]
// ---------------------------------------------------------------------------
describe("GET /api/notes/[noteId]", () => {
  it("returns 401 when unauthenticated", async () => {
    anon();
    const res = await noteGet(new Request("http://localhost"), params());
    expect(res.status).toBe(401);
  });

  it("returns 200 with note detail when authed", async () => {
    authed();
    vi.mocked(getNoteDetailForUser).mockResolvedValue(STUB_DETAIL as never);
    const res = await noteGet(new Request("http://localhost"), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.note.id).toBe(NOTE_ID);
  });

  it("returns 404 when note not found", async () => {
    authed();
    vi.mocked(getNoteDetailForUser).mockRejectedValue(new NotesError("NOT_FOUND", "not found"));
    const res = await noteGet(new Request("http://localhost"), params());
    expect(res.status).toBe(404);
  });

  it("returns 403 when user lacks read permission", async () => {
    authed();
    vi.mocked(getNoteDetailForUser).mockRejectedValue(new NotesError("FORBIDDEN", "denied"));
    const res = await noteGet(new Request("http://localhost"), params());
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/notes/[noteId]
// ---------------------------------------------------------------------------
describe("PATCH /api/notes/[noteId]", () => {
  function patchReq(body: unknown) {
    return new Request("http://localhost", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns 401 when unauthenticated", async () => {
    anon();
    const res = await notePatch(patchReq({ title: "x" }), params());
    expect(res.status).toBe(401);
  });

  it("returns 422 when body is invalid JSON", async () => {
    authed();
    const req = new Request("http://localhost", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "not-json{{{",
    });
    const res = await notePatch(req, params());
    expect(res.status).toBe(422);
  });

  it("returns 422 when title is empty string", async () => {
    authed();
    const res = await notePatch(patchReq({ title: "" }), params());
    expect(res.status).toBe(422);
  });

  it("returns 200 on successful update", async () => {
    authed();
    vi.mocked(updateNote).mockResolvedValue(STUB_DETAIL.note as never);
    const res = await notePatch(patchReq({ title: "New title" }), params());
    expect(res.status).toBe(200);
  });

  it("returns 403 when user cannot write", async () => {
    authed();
    vi.mocked(updateNote).mockRejectedValue(new NotesError("FORBIDDEN", "no write"));
    const res = await notePatch(patchReq({ title: "x" }), params());
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/notes/[noteId]
// ---------------------------------------------------------------------------
describe("DELETE /api/notes/[noteId]", () => {
  it("returns 401 when unauthenticated", async () => {
    anon();
    const res = await noteDelete(new Request("http://localhost"), params());
    expect(res.status).toBe(401);
  });

  it("returns 200 with noteId on success", async () => {
    authed();
    vi.mocked(deleteNote).mockResolvedValue(undefined);
    const res = await noteDelete(new Request("http://localhost"), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.noteId).toBe(NOTE_ID);
  });

  it("returns 403 when user cannot delete", async () => {
    authed();
    vi.mocked(deleteNote).mockRejectedValue(new NotesError("FORBIDDEN", "only author"));
    const res = await noteDelete(new Request("http://localhost"), params());
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api/notes/[noteId]/shares
// ---------------------------------------------------------------------------
describe("GET /api/notes/[noteId]/shares", () => {
  it("returns 401 when unauthenticated", async () => {
    anon();
    const res = await sharesGet(new Request("http://localhost"), params());
    expect(res.status).toBe(401);
  });

  it("returns 200 with shares array", async () => {
    authed();
    vi.mocked(getNoteDetailForUser).mockResolvedValue(STUB_DETAIL as never);
    const res = await sharesGet(new Request("http://localhost"), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.shares).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/notes/[noteId]/shares
// ---------------------------------------------------------------------------
describe("POST /api/notes/[noteId]/shares", () => {
  const TARGET_USER = "bbbbbbbb-0000-0000-0000-000000000002";

  function shareReq(body: unknown) {
    return new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns 401 when unauthenticated", async () => {
    anon();
    const res = await sharesPost(shareReq({ sharedWithUserId: TARGET_USER, permission: "view" }), params());
    expect(res.status).toBe(401);
  });

  it("returns 422 when permission is invalid", async () => {
    authed();
    const res = await sharesPost(shareReq({ sharedWithUserId: TARGET_USER, permission: "admin" }), params());
    expect(res.status).toBe(422);
  });

  it("returns 422 when sharedWithUserId is not a UUID", async () => {
    authed();
    const res = await sharesPost(shareReq({ sharedWithUserId: "not-uuid", permission: "view" }), params());
    expect(res.status).toBe(422);
  });

  it("returns 200 on successful share", async () => {
    authed();
    vi.mocked(upsertNoteShare).mockResolvedValue({ note: STUB_DETAIL.note, members: [] } as never);
    const res = await sharesPost(shareReq({ sharedWithUserId: TARGET_USER, permission: "view" }), params());
    expect(res.status).toBe(200);
  });

  it("returns 403 when user cannot share", async () => {
    authed();
    vi.mocked(upsertNoteShare).mockRejectedValue(new NotesError("FORBIDDEN", "no share perm"));
    const res = await sharesPost(shareReq({ sharedWithUserId: TARGET_USER, permission: "view" }), params());
    expect(res.status).toBe(403);
  });
});
