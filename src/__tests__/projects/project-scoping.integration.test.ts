/**
 * Project scoping boundary — query-layer integration tests.
 *
 * Verifies that project_key correctly partitions notes, search results,
 * and timeline events. The "no leakage" guarantee is the load-bearing one:
 * a query for project A must never return a row tagged with project B.
 *
 * Run locally:
 *   DATABASE_URL=postgresql://... npm run test:integration -- project-scoping
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

vi.mock("@/lib/graph/queue", () => ({ enqueueSync: vi.fn(), enqueueDelete: vi.fn() }));
vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// audit.ts is exercised separately by audit() callers; mock it here so
// project_key resolution on note-resource events doesn't fire spurious DB reads.
vi.mock("@/lib/log/audit", () => ({ audit: vi.fn() }));

import { createNote, listNotesForUser } from "@/lib/notes/crud";
import { searchNotes } from "@/lib/search";
import { getOrgTimeline } from "@/lib/timeline/queries";
import { listAgentSessions } from "@/lib/agent/queries";

const ORG_ID  = randomUUID();
const USER_ID = randomUUID();

const PROJECT_A = "test-org/repo-a";
const PROJECT_B = "test-org/repo-b";

let sql: ReturnType<typeof postgres>;

// Note IDs captured so each test can assert specific rows.
const noteIds: Record<string, string> = {};

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set — cannot run integration tests");
  sql = postgres(url, { max: 1, prepare: false });

  // Minimal user/org/membership scaffold.
  await sql.unsafe(`INSERT INTO auth.users (id, email) VALUES ('${USER_ID}', 'proj-scope@test.com') ON CONFLICT (id) DO NOTHING`);
  await sql.unsafe(`INSERT INTO users (id, email) VALUES ('${USER_ID}', 'proj-scope@test.com') ON CONFLICT (id) DO NOTHING`);
  await sql.unsafe(`INSERT INTO orgs (id, name, slug, created_by) VALUES ('${ORG_ID}', 'Proj Scope Org', 'proj-scope-${ORG_ID.slice(0, 8)}', '${USER_ID}') ON CONFLICT (id) DO NOTHING`);
  await sql.unsafe(`INSERT INTO memberships (org_id, user_id, role) VALUES ('${ORG_ID}', '${USER_ID}', 'member') ON CONFLICT DO NOTHING`);

  // Three notes: one per project + one unscoped.
  const a = await createNote(
    { orgId: ORG_ID, title: "Note in project A", content: "alpha alpha", visibility: "org", tags: [], projectKey: PROJECT_A },
    USER_ID,
  );
  noteIds.a = a.id;
  const b = await createNote(
    { orgId: ORG_ID, title: "Note in project B", content: "beta beta", visibility: "org", tags: [], projectKey: PROJECT_B },
    USER_ID,
  );
  noteIds.b = b.id;
  const u = await createNote(
    { orgId: ORG_ID, title: "Unscoped memo", content: "gamma gamma", visibility: "org", tags: [] },
    USER_ID,
  );
  noteIds.u = u.id;

  // Seed audit_log rows so timeline tests have project-tagged events to filter.
  // Manual inserts: bypass the audit() helper to avoid coupling to that path's
  // resolver behavior, which is exercised by other tests.
  await sql.unsafe(`
    INSERT INTO audit_log (action, org_id, user_id, resource_type, resource_id, project_key, metadata)
    VALUES
      ('note.update', '${ORG_ID}', '${USER_ID}', 'note', '${noteIds.a}', '${PROJECT_A}', '{}'),
      ('note.update', '${ORG_ID}', '${USER_ID}', 'note', '${noteIds.b}', '${PROJECT_B}', '{}'),
      ('search.execute', '${ORG_ID}', '${USER_ID}', 'search', NULL, NULL, '{}')
  `);

  // Seed agent_sessions for listAgentSessions tests.
  await sql.unsafe(`
    INSERT INTO agent_sessions (org_id, note_id, agent_id, repo, branch)
    VALUES
      ('${ORG_ID}', '${noteIds.a}', 'agent-A', '${PROJECT_A}', 'main'),
      ('${ORG_ID}', '${noteIds.b}', 'agent-B', '${PROJECT_B}', 'main')
    ON CONFLICT DO NOTHING
  `);
});

afterAll(async () => {
  if (sql) {
    for (const id of Object.values(noteIds)) {
      await sql.unsafe(`DELETE FROM agent_sessions WHERE note_id = '${id}'`);
      await sql.unsafe(`DELETE FROM audit_log WHERE resource_id = '${id}'`);
      await sql.unsafe(`DELETE FROM note_versions WHERE note_id = '${id}'`);
      await sql.unsafe(`DELETE FROM notes WHERE id = '${id}'`);
    }
    await sql.unsafe(`DELETE FROM audit_log WHERE org_id = '${ORG_ID}'`);
    await sql.unsafe(`DELETE FROM memberships WHERE org_id = '${ORG_ID}'`);
    await sql.unsafe(`DELETE FROM orgs WHERE id = '${ORG_ID}'`);
    await sql.unsafe(`DELETE FROM users WHERE id = '${USER_ID}'`);
    await sql.unsafe(`DELETE FROM auth.users WHERE id = '${USER_ID}'`);
    await sql.end();
  }
});

describe("notes.project_key — write side", () => {
  it("createNote with projectKey persists the column", async () => {
    const [row] = await sql<{ project_key: string | null }[]>`
      SELECT project_key FROM notes WHERE id = ${noteIds.a}`;
    expect(row.project_key).toBe(PROJECT_A);
  });

  it("createNote without projectKey leaves the column NULL", async () => {
    const [row] = await sql<{ project_key: string | null }[]>`
      SELECT project_key FROM notes WHERE id = ${noteIds.u}`;
    expect(row.project_key).toBeNull();
  });
});

describe("listNotesForUser — project filter", () => {
  it("default (no projectKey) returns notes across all projects + unscoped", async () => {
    const result = await listNotesForUser({ orgId: ORG_ID, limit: 100 }, USER_ID);
    const ids = result.notes.map((n) => n.id);
    expect(ids).toContain(noteIds.a);
    expect(ids).toContain(noteIds.b);
    expect(ids).toContain(noteIds.u);
  });

  it("projectKey=A + includeUnscoped (default true) returns A + unscoped, never B", async () => {
    const result = await listNotesForUser(
      { orgId: ORG_ID, limit: 100, projectKey: PROJECT_A },
      USER_ID,
    );
    const ids = result.notes.map((n) => n.id);
    expect(ids).toContain(noteIds.a);
    expect(ids).toContain(noteIds.u);
    expect(ids).not.toContain(noteIds.b); // boundary
  });

  it("projectKey=A + includeUnscoped=false returns A only, never B or unscoped", async () => {
    const result = await listNotesForUser(
      { orgId: ORG_ID, limit: 100, projectKey: PROJECT_A, includeUnscoped: false },
      USER_ID,
    );
    const ids = result.notes.map((n) => n.id);
    expect(ids).toContain(noteIds.a);
    expect(ids).not.toContain(noteIds.b); // boundary
    expect(ids).not.toContain(noteIds.u); // strict-mode excludes unscoped
  });
});

describe("searchNotes — project filter", () => {
  it("default search returns hits from every project", async () => {
    const response = await searchNotes(
      { orgId: ORG_ID, q: "alpha beta gamma", visibility: "all", page: 1, pageSize: 50 },
      { orgId: ORG_ID, userId: USER_ID },
    );
    const ids = response.results.map((r) => r.id);
    expect(ids).toContain(noteIds.a);
    expect(ids).toContain(noteIds.b);
    expect(ids).toContain(noteIds.u);
  });

  it("projectKey=A excludes project B notes (boundary)", async () => {
    const response = await searchNotes(
      { orgId: ORG_ID, q: "alpha beta gamma", visibility: "all", page: 1, pageSize: 50, projectKey: PROJECT_A },
      { orgId: ORG_ID, userId: USER_ID },
    );
    const ids = response.results.map((r) => r.id);
    expect(ids).toContain(noteIds.a);
    expect(ids).not.toContain(noteIds.b);
  });

  it("projectKey=A + includeUnscoped=false strict-mode excludes unscoped", async () => {
    const response = await searchNotes(
      { orgId: ORG_ID, q: "alpha beta gamma", visibility: "all", page: 1, pageSize: 50, projectKey: PROJECT_A, includeUnscoped: false },
      { orgId: ORG_ID, userId: USER_ID },
    );
    const ids = response.results.map((r) => r.id);
    expect(ids).toContain(noteIds.a);
    expect(ids).not.toContain(noteIds.b);
    expect(ids).not.toContain(noteIds.u);
  });
});

describe("getOrgTimeline — project filter", () => {
  it("default returns events from every project + unscoped events", async () => {
    const events = await getOrgTimeline(ORG_ID, 100);
    const noteIdsInEvents = events
      .filter((e) => e.resourceType === "note")
      .map((e) => e.resourceId);
    expect(noteIdsInEvents).toContain(noteIds.a);
    expect(noteIdsInEvents).toContain(noteIds.b);
    // search.execute event (project_key=NULL) is also present
    expect(events.some((e) => e.action === "search.execute")).toBe(true);
  });

  it("projectKey=A excludes project B events (boundary)", async () => {
    const events = await getOrgTimeline(ORG_ID, 100, { projectKey: PROJECT_A });
    const noteIdsInEvents = events
      .filter((e) => e.resourceType === "note")
      .map((e) => e.resourceId);
    expect(noteIdsInEvents).toContain(noteIds.a);
    expect(noteIdsInEvents).not.toContain(noteIds.b);
    // includeUnscoped default true → null-project events still visible
    expect(events.some((e) => e.action === "search.execute")).toBe(true);
  });

  it("projectKey=A + includeUnscoped=false strict-mode excludes null-project events", async () => {
    const events = await getOrgTimeline(ORG_ID, 100, {
      projectKey: PROJECT_A,
      includeUnscoped: false,
    });
    const noteIdsInEvents = events
      .filter((e) => e.resourceType === "note")
      .map((e) => e.resourceId);
    expect(noteIdsInEvents).toContain(noteIds.a);
    expect(noteIdsInEvents).not.toContain(noteIds.b);
    expect(events.some((e) => e.action === "search.execute")).toBe(false);
  });
});

describe("listAgentSessions — project filter", () => {
  it("default returns sessions across all projects", async () => {
    const sessions = await listAgentSessions(ORG_ID, 100);
    const repos = sessions.map((s) => s.repo);
    expect(repos).toContain(PROJECT_A);
    expect(repos).toContain(PROJECT_B);
  });

  it("projectKey=A returns only that repo's sessions (boundary)", async () => {
    const sessions = await listAgentSessions(ORG_ID, 100, { projectKey: PROJECT_A });
    const repos = sessions.map((s) => s.repo);
    expect(repos).toContain(PROJECT_A);
    expect(repos).not.toContain(PROJECT_B);
  });
});
