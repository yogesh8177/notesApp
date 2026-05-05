/**
 * getNotePermission integration tests — real Postgres.
 *
 * These tests close the gap that the unit tests cannot: they verify the
 * actual SQL join (notes + memberships + note_shares) returns the correct
 * permission flags for every visibility × role combination.
 *
 * If a column is renamed or the join condition changes, these tests will fail
 * where the unit tests would still pass.
 *
 * Run locally:
 *   DATABASE_URL=postgresql://... npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/log/audit", () => ({ audit: vi.fn() }));

import { getNotePermission } from "@/lib/auth/permissions";

const ORG_ID      = randomUUID();
const AUTHOR_ID   = randomUUID(); // note author, member role
const MEMBER_ID   = randomUUID(); // plain member, no share
const ADMIN_ID    = randomUUID(); // org admin
const OUTSIDER_ID = randomUUID(); // not in org at all
const SHARED_WITH = randomUUID(); // member with a share

let sql: ReturnType<typeof postgres>;
let privateNoteId: string;
let orgNoteId: string;
let sharedNoteId: string;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  sql = postgres(url, { max: 1, prepare: false });

  const users = [AUTHOR_ID, MEMBER_ID, ADMIN_ID, OUTSIDER_ID, SHARED_WITH];
  for (const [i, id] of users.entries()) {
    await sql.unsafe(`INSERT INTO auth.users (id, email) VALUES ('${id}', 'perm-int-${i}@test.com') ON CONFLICT (id) DO NOTHING`);
    await sql.unsafe(`INSERT INTO users (id, email) VALUES ('${id}', 'perm-int-${i}@test.com') ON CONFLICT (id) DO NOTHING`);
  }

  await sql.unsafe(`INSERT INTO orgs (id, name, slug, created_by) VALUES ('${ORG_ID}', 'Perm Org', 'perm-org-${ORG_ID.slice(0,8)}', '${AUTHOR_ID}') ON CONFLICT (id) DO NOTHING`);

  await sql.unsafe(`INSERT INTO memberships (org_id, user_id, role) VALUES
    ('${ORG_ID}', '${AUTHOR_ID}',   'member'),
    ('${ORG_ID}', '${MEMBER_ID}',   'member'),
    ('${ORG_ID}', '${ADMIN_ID}',    'admin'),
    ('${ORG_ID}', '${SHARED_WITH}', 'member')
    ON CONFLICT DO NOTHING`);

  // Create notes
  const [pn] = await sql<{ id: string }[]>`
    INSERT INTO notes (org_id, author_id, title, content, visibility, current_version)
    VALUES (${ORG_ID}, ${AUTHOR_ID}, 'Private', 'body', 'private', 1) RETURNING id`;
  privateNoteId = pn.id;

  const [on] = await sql<{ id: string }[]>`
    INSERT INTO notes (org_id, author_id, title, content, visibility, current_version)
    VALUES (${ORG_ID}, ${AUTHOR_ID}, 'Org', 'body', 'org', 1) RETURNING id`;
  orgNoteId = on.id;

  const [sn] = await sql<{ id: string }[]>`
    INSERT INTO notes (org_id, author_id, title, content, visibility, current_version)
    VALUES (${ORG_ID}, ${AUTHOR_ID}, 'Shared', 'body', 'shared', 1) RETURNING id`;
  sharedNoteId = sn.id;

  // Grant view share on sharedNote to SHARED_WITH
  await sql.unsafe(`INSERT INTO note_shares (note_id, shared_by, shared_with_user_id, permission)
    VALUES ('${sharedNoteId}', '${AUTHOR_ID}', '${SHARED_WITH}', 'view') ON CONFLICT DO NOTHING`);
});

afterAll(async () => {
  if (sql) {
    for (const id of [privateNoteId, orgNoteId, sharedNoteId]) {
      if (id) {
        await sql.unsafe(`DELETE FROM note_shares  WHERE note_id = '${id}'`);
        await sql.unsafe(`DELETE FROM note_versions WHERE note_id = '${id}'`);
        await sql.unsafe(`DELETE FROM notes        WHERE id = '${id}'`);
      }
    }
    await sql.unsafe(`DELETE FROM memberships WHERE org_id = '${ORG_ID}'`);
    await sql.unsafe(`DELETE FROM orgs  WHERE id = '${ORG_ID}'`);
    for (const id of [AUTHOR_ID, MEMBER_ID, ADMIN_ID, OUTSIDER_ID, SHARED_WITH]) {
      await sql.unsafe(`DELETE FROM users       WHERE id = '${id}'`);
      await sql.unsafe(`DELETE FROM auth.users  WHERE id = '${id}'`);
    }
    await sql.end();
  }
});

describe("getNotePermission — private notes", () => {
  it("author can read and write their own private note", async () => {
    const p = await getNotePermission(privateNoteId, AUTHOR_ID);
    expect(p.canRead).toBe(true);
    expect(p.canWrite).toBe(true);
    expect(p.canShare).toBe(true);
    expect(p.canDelete).toBe(true);
  });

  it("org member cannot read a private note they did not author", async () => {
    const p = await getNotePermission(privateNoteId, MEMBER_ID);
    expect(p.canRead).toBe(false);
  });

  it("admin can read a private note they did not author", async () => {
    const p = await getNotePermission(privateNoteId, ADMIN_ID);
    expect(p.canRead).toBe(true);
    expect(p.canWrite).toBe(true);
  });

  it("outsider (non-member) cannot read a private note", async () => {
    const p = await getNotePermission(privateNoteId, OUTSIDER_ID);
    expect(p.canRead).toBe(false);
  });
});

describe("getNotePermission — org-visible notes", () => {
  it("author has full permissions on org note", async () => {
    const p = await getNotePermission(orgNoteId, AUTHOR_ID);
    expect(p.canRead).toBe(true);
    expect(p.canWrite).toBe(true);
    expect(p.canShare).toBe(true);
    expect(p.canDelete).toBe(true);
  });

  it("org member can read but not write or share", async () => {
    const p = await getNotePermission(orgNoteId, MEMBER_ID);
    expect(p.canRead).toBe(true);
    expect(p.canWrite).toBe(false);
    expect(p.canShare).toBe(false);
  });

  it("admin can read and write org note", async () => {
    const p = await getNotePermission(orgNoteId, ADMIN_ID);
    expect(p.canRead).toBe(true);
    expect(p.canWrite).toBe(true);
    expect(p.canShare).toBe(true);
  });

  it("outsider cannot read an org note", async () => {
    const p = await getNotePermission(orgNoteId, OUTSIDER_ID);
    expect(p.canRead).toBe(false);
  });
});

describe("getNotePermission — shared notes", () => {
  it("author has full permissions on shared note", async () => {
    const p = await getNotePermission(sharedNoteId, AUTHOR_ID);
    expect(p.canRead).toBe(true);
    expect(p.canWrite).toBe(true);
  });

  it("member without a share cannot read shared note", async () => {
    const p = await getNotePermission(sharedNoteId, MEMBER_ID);
    expect(p.canRead).toBe(false);
  });

  it("member with view share can read but not write", async () => {
    const p = await getNotePermission(sharedNoteId, SHARED_WITH);
    expect(p.canRead).toBe(true);
    expect(p.canWrite).toBe(false);
  });

  it("outsider cannot read a shared note", async () => {
    const p = await getNotePermission(sharedNoteId, OUTSIDER_ID);
    expect(p.canRead).toBe(false);
  });
});

describe("getNotePermission — deleted note", () => {
  it("returns not-found for a soft-deleted note", async () => {
    const [deleted] = await sql<{ id: string }[]>`
      INSERT INTO notes (org_id, author_id, title, content, visibility, current_version, deleted_at)
      VALUES (${ORG_ID}, ${AUTHOR_ID}, 'Gone', 'x', 'org', 1, NOW()) RETURNING id`;
    const p = await getNotePermission(deleted.id, AUTHOR_ID);
    expect(p.canRead).toBe(false);
    expect(p.reason).toBe("not-found");
    await sql.unsafe(`DELETE FROM notes WHERE id = '${deleted.id}'`);
  });
});
