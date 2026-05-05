/**
 * Unit tests for GET /api/notes and POST /api/notes.
 * Auth via mocked Supabase; service layer fully mocked.
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

import { GET, POST } from "@/app/api/notes/route";
import { createClient } from "@/lib/supabase/server";
import { listNotesForUser, createNote } from "@/lib/notes/crud";
import { NotesError } from "@/lib/notes/errors";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID  = "22222222-2222-2222-2222-222222222222";

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

function getReq(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/notes");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

function postReq(body: unknown) {
  return new Request("http://localhost/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const STUB_LIST = {
  notes: [], nextCursor: null, members: [], availableTags: [],
};

const STUB_NOTE = {
  id: "note-id", orgId: ORG_ID, title: "T", content: "C",
  visibility: "org", currentVersion: 1,
  createdAt: new Date(), updatedAt: new Date(),
  author: { id: USER_ID, email: "a@b.com", displayName: null },
  tags: [], shares: [], history: [], permissions: {},
};

beforeEach(() => vi.resetAllMocks());

describe("GET /api/notes", () => {
  it("returns 401 when unauthenticated", async () => {
    anon();
    const res = await GET(getReq({ orgId: ORG_ID }));
    expect(res.status).toBe(401);
  });

  it("returns 422 when orgId is missing", async () => {
    authed();
    const res = await GET(getReq());
    expect(res.status).toBe(422);
  });

  it("returns 422 when orgId is not a UUID", async () => {
    authed();
    const res = await GET(getReq({ orgId: "not-a-uuid" }));
    expect(res.status).toBe(422);
  });

  it("returns 200 with note list when authed", async () => {
    authed();
    vi.mocked(listNotesForUser).mockResolvedValue(STUB_LIST);
    const res = await GET(getReq({ orgId: ORG_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.notes).toEqual([]);
  });

  it("calls listNotesForUser with the authenticated user id", async () => {
    authed("specific-user-id");
    vi.mocked(listNotesForUser).mockResolvedValue(STUB_LIST);
    await GET(getReq({ orgId: ORG_ID }));
    expect(vi.mocked(listNotesForUser)).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG_ID }),
      "specific-user-id",
    );
  });

  it("returns 403 when service throws FORBIDDEN", async () => {
    authed();
    vi.mocked(listNotesForUser).mockRejectedValue(new NotesError("FORBIDDEN", "not a member"));
    const res = await GET(getReq({ orgId: ORG_ID }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/notes", () => {
  const validBody = {
    orgId: ORG_ID,
    title: "My note",
    content: "body text",
    visibility: "org",
    tags: [],
  };

  it("returns 401 when unauthenticated", async () => {
    anon();
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(401);
  });

  it("returns 422 when body is not valid JSON", async () => {
    authed();
    const req = new Request("http://localhost/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{{bad json",
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it("returns 422 when body fails schema validation", async () => {
    authed();
    const res = await POST(postReq({ orgId: ORG_ID, title: "" }));
    expect(res.status).toBe(422);
  });

  it("returns 200 with created note on success", async () => {
    authed();
    vi.mocked(createNote).mockResolvedValue(STUB_NOTE as never);
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe("note-id");
  });

  it("returns 403 when service throws FORBIDDEN", async () => {
    authed();
    vi.mocked(createNote).mockRejectedValue(new NotesError("FORBIDDEN", "not a member"));
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(403);
  });

  it("returns 500 when service throws unexpected error", async () => {
    authed();
    vi.mocked(createNote).mockRejectedValue(new Error("db exploded"));
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(500);
  });
});
