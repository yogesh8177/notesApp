/**
 * Notes CRUD integration tests — real Postgres, mocked graph queue.
 *
 * Verifies the full write path: createNote, updateNote (real change),
 * updateNote (no-op), deleteNote — including version bumps, soft-delete,
 * and that the no-op guard does not increment currentVersion.
 *
 * Run locally:
 *   DATABASE_URL=postgresql://... npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

vi.mock("@/lib/graph/queue", () => ({ enqueueSync: vi.fn(), enqueueDelete: vi.fn() }));
vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/log/audit", () => ({ audit: vi.fn() }));

import { createNote, updateNote, deleteNote, getNoteDetailForUser } from "@/lib/notes/crud";

const ORG_ID  = randomUUID();
const USER_ID = randomUUID();

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  sql = postgres(url, { max: 1, prepare: false });

  await sql.unsafe(`INSERT INTO auth.users (id, email) VALUES ('${USER_ID}', 'crud-int@test.com') ON CONFLICT (id) DO NOTHING`);
  await sql.unsafe(`INSERT INTO users (id, email) VALUES ('${USER_ID}', 'crud-int@test.com') ON CONFLICT (id) DO NOTHING`);
  await sql.unsafe(`INSERT INTO orgs (id, name, slug, created_by) VALUES ('${ORG_ID}', 'CRUD Org', 'crud-org-${ORG_ID.slice(0,8)}', '${USER_ID}') ON CONFLICT (id) DO NOTHING`);
  await sql.unsafe(`INSERT INTO memberships (org_id, user_id, role) VALUES ('${ORG_ID}', '${USER_ID}', 'member') ON CONFLICT DO NOTHING`);
});

afterAll(async () => {
  if (sql) {
    await sql.unsafe(`DELETE FROM memberships WHERE org_id = '${ORG_ID}'`);
    await sql.unsafe(`DELETE FROM orgs  WHERE id = '${ORG_ID}'`);
    await sql.unsafe(`DELETE FROM users WHERE id = '${USER_ID}'`);
    await sql.unsafe(`DELETE FROM auth.users WHERE id = '${USER_ID}'`);
    await sql.end();
  }
});

describe("createNote — real Postgres", () => {
  let noteId: string;

  afterAll(async () => {
    if (noteId) {
      await sql.unsafe(`DELETE FROM note_versions WHERE note_id = '${noteId}'`);
      await sql.unsafe(`DELETE FROM notes WHERE id = '${noteId}'`);
    }
  });

  it("inserts a note and its first version snapshot", async () => {
    const note = await createNote(
      { orgId: ORG_ID, title: "Integration note", content: "hello", visibility: "org", tags: [] },
      USER_ID,
    );
    noteId = note.id;

    expect(note.title).toBe("Integration note");
    expect(note.currentVersion).toBe(1);
    expect(note.orgId).toBe(ORG_ID);

    const [vrow] = await sql<{ version: number }[]>`
      SELECT version FROM note_versions WHERE note_id = ${noteId} ORDER BY version`;
    expect(vrow.version).toBe(1);
  });
});

describe("updateNote — real Postgres", () => {
  let noteId: string;

  beforeAll(async () => {
    const note = await createNote(
      { orgId: ORG_ID, title: "Before", content: "original", visibility: "org", tags: ["x"] },
      USER_ID,
    );
    noteId = note.id;
  });

  afterAll(async () => {
    if (noteId) {
      await sql.unsafe(`DELETE FROM note_versions WHERE note_id = '${noteId}'`);
      await sql.unsafe(`DELETE FROM notes WHERE id = '${noteId}'`);
    }
  });

  it("bumps currentVersion when content changes", async () => {
    const updated = await updateNote(noteId, { content: "changed body" }, USER_ID);
    expect(updated.currentVersion).toBe(2);
    expect(updated.content).toBe("changed body");
  });

  it("writes a new version row on a real change", async () => {
    const rows = await sql<{ version: number }[]>`
      SELECT version FROM note_versions WHERE note_id = ${noteId} ORDER BY version`;
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
  });

  it("does NOT bump currentVersion when nothing changed (no-op)", async () => {
    const before = await getNoteDetailForUser(noteId, USER_ID);
    const result = await updateNote(
      noteId,
      {
        title: before.note.title,
        content: before.note.content,
        visibility: before.note.visibility,
        tags: before.note.tags,
      },
      USER_ID,
    );
    expect(result.currentVersion).toBe(before.note.currentVersion);
  });

  it("does NOT write a new version row on a no-op", async () => {
    const rows = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM note_versions WHERE note_id = ${noteId}`;
    // Still 2 versions from the real update above — no-op added none
    expect(Number(rows[0].count)).toBe(2);
  });
});

describe("deleteNote — real Postgres", () => {
  let noteId: string;

  beforeAll(async () => {
    const note = await createNote(
      { orgId: ORG_ID, title: "To delete", content: "bye", visibility: "org", tags: [] },
      USER_ID,
    );
    noteId = note.id;
  });

  afterAll(async () => {
    if (noteId) {
      await sql.unsafe(`DELETE FROM note_versions WHERE note_id = '${noteId}'`);
      await sql.unsafe(`DELETE FROM notes WHERE id = '${noteId}'`);
    }
  });

  it("soft-deletes the note (sets deletedAt)", async () => {
    await deleteNote(noteId, USER_ID);
    const [row] = await sql<{ deleted_at: Date | null }[]>`
      SELECT deleted_at FROM notes WHERE id = ${noteId}`;
    expect(row.deleted_at).not.toBeNull();
  });

  it("getNoteDetailForUser throws NOT_FOUND after soft-delete", async () => {
    await expect(getNoteDetailForUser(noteId, USER_ID)).rejects.toThrow();
  });
});
