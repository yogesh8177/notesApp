/**
 * e2e — Cross-project boundary at the recall endpoint
 *
 * The recall hook (.claude/hooks/recall.js) authenticates with a bearer
 * agent token and POSTs to /agent/search with a projectKey it derived from
 * the local git remote. The endpoint MUST return only notes from that
 * project plus unscoped notes — never notes belonging to another project
 * in the same org.
 *
 * Why this is an e2e and not an integration test: the existing integration
 * suite covers the query helper directly. This spec covers the HTTP contract
 * the production recall hook depends on, including bearer auth, JSON shape,
 * and the project_key column reaching the SQL filter.
 */
import { test, expect } from "@playwright/test";
import { randomBytes, createHash } from "node:crypto";
import {
  createTestUser,
  createTestOrg,
  createTestNote,
  deleteTestOrg,
  deleteTestUser,
  closeSql,
  getSql,
  type TestUser,
  type TestOrg,
  type TestNote,
} from "./fixtures/db";

const PROJECT_A = `proj-a-${Date.now()}`;
const PROJECT_B = `proj-b-${Date.now()}`;

let userA: TestUser;
let orgA: TestOrg;
let noteInA: TestNote;
let noteInB: TestNote;
let noteUnscoped: TestNote;
let agentToken: string;

test.beforeAll(async () => {
  userA = await createTestUser("cross-project-a");
  orgA = await createTestOrg(userA.id, "cross-project");

  // Seed three notes with different scoping.
  noteInA = await createTestNote(orgA.id, userA.id, "Note in A", "alpha alpha alpha", "org", PROJECT_A);
  noteInB = await createTestNote(orgA.id, userA.id, "Note in B", "beta beta beta", "org", PROJECT_B);
  noteUnscoped = await createTestNote(orgA.id, userA.id, "Unscoped memo", "gamma gamma gamma", "org", null);

  // Mint an agent token bound to (orgA, userA). Same shape the production
  // settings UI mints; we cut out the UI to keep the test fast.
  const cleartext = `nat_${randomBytes(16).toString("hex")}`;
  const hash = createHash("sha256").update(cleartext).digest("hex");
  agentToken = cleartext;

  const sql = getSql();
  await sql.unsafe(
    `INSERT INTO agent_tokens (org_id, user_id, name, token_prefix, token_hash, created_by)
     VALUES ('${orgA.id}', '${userA.id}', 'cross-project-e2e', '${cleartext.slice(4, 12)}', '${hash}', '${userA.id}')`,
  );
});

test.afterAll(async () => {
  const sql = getSql();
  await sql.unsafe(`DELETE FROM agent_tokens WHERE org_id = '${orgA.id}'`);
  for (const n of [noteInA, noteInB, noteUnscoped]) {
    await sql.unsafe(`DELETE FROM note_versions WHERE note_id = '${n.id}'`);
    await sql.unsafe(`DELETE FROM notes WHERE id = '${n.id}'`);
  }
  await deleteTestOrg(orgA.id);
  await deleteTestUser(userA.id);
  await closeSql();
});

test("recall: no projectKey returns notes from every project + unscoped", async ({ request }) => {
  const res = await request.post("/agent/search", {
    headers: { Authorization: `Bearer ${agentToken}` },
    data: { q: "alpha beta gamma", limit: 20 },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  const ids = (body.data?.results ?? []).map((r: { id: string }) => r.id);
  expect(ids).toContain(noteInA.id);
  expect(ids).toContain(noteInB.id);
  expect(ids).toContain(noteUnscoped.id);
});

test("recall: projectKey=A returns project A + unscoped, never B (boundary)", async ({ request }) => {
  const res = await request.post("/agent/search", {
    headers: { Authorization: `Bearer ${agentToken}` },
    data: { q: "alpha beta gamma", limit: 20, projectKey: PROJECT_A, includeUnscoped: true },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  const ids = (body.data?.results ?? []).map((r: { id: string }) => r.id);
  expect(ids).toContain(noteInA.id);
  expect(ids).toContain(noteUnscoped.id);
  expect(ids).not.toContain(noteInB.id); // load-bearing assertion
});

test("recall: projectKey=B returns project B + unscoped, never A (boundary, reverse)", async ({ request }) => {
  const res = await request.post("/agent/search", {
    headers: { Authorization: `Bearer ${agentToken}` },
    data: { q: "alpha beta gamma", limit: 20, projectKey: PROJECT_B, includeUnscoped: true },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  const ids = (body.data?.results ?? []).map((r: { id: string }) => r.id);
  expect(ids).toContain(noteInB.id);
  expect(ids).toContain(noteUnscoped.id);
  expect(ids).not.toContain(noteInA.id); // boundary the opposite way
});

test("recall: projectKey=A + includeUnscoped=false excludes unscoped (strict mode)", async ({ request }) => {
  const res = await request.post("/agent/search", {
    headers: { Authorization: `Bearer ${agentToken}` },
    data: { q: "alpha beta gamma", limit: 20, projectKey: PROJECT_A, includeUnscoped: false },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  const ids = (body.data?.results ?? []).map((r: { id: string }) => r.id);
  expect(ids).toContain(noteInA.id);
  expect(ids).not.toContain(noteInB.id);
  expect(ids).not.toContain(noteUnscoped.id);
});

test("recall: unknown projectKey returns only unscoped (default includeUnscoped)", async ({ request }) => {
  const res = await request.post("/agent/search", {
    headers: { Authorization: `Bearer ${agentToken}` },
    data: { q: "alpha beta gamma", limit: 20, projectKey: "nonexistent-org/nonexistent-repo" },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  const ids = (body.data?.results ?? []).map((r: { id: string }) => r.id);
  expect(ids).toContain(noteUnscoped.id);
  expect(ids).not.toContain(noteInA.id);
  expect(ids).not.toContain(noteInB.id);
});
