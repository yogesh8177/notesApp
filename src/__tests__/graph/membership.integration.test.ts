/**
 * Postgres membership integration tests.
 *
 * These tests run against a real Postgres instance seeded with the app schema.
 * They verify that getMembership returns the right result for members,
 * non-members, and cross-org queries — closing the gap that unit tests with
 * a mocked getMembership cannot cover.
 *
 * The route-level test at the bottom also verifies the full gate: real DB +
 * mocked Supabase auth → 200 for members, 403 for non-members / cross-org.
 *
 * Run locally:
 *   DATABASE_URL=postgresql://... npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

// Module mocks must be declared before any imports that use them.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/graph/client",    () => ({ getDriver: vi.fn(), ensureIndexes: vi.fn() }));
vi.mock("@/lib/graph/queries",   () => ({ getNodeNeighborhood: vi.fn(), isStale: vi.fn() }));
vi.mock("@/lib/graph/sync",      () => ({ syncNode: vi.fn() }));
vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { NextRequest } from "next/server";
import { getMembership } from "@/lib/auth/org";
import { GET } from "@/app/api/graph/node/[type]/[id]/route";
import { createClient } from "@/lib/supabase/server";
import { getDriver } from "@/lib/graph/client";
import { getNodeNeighborhood, isStale } from "@/lib/graph/queries";
import { syncNode } from "@/lib/graph/sync";

// Test-scoped UUIDs — cleaned up in afterAll.
const ORG_A_ID   = randomUUID();
const ORG_B_ID   = randomUUID();
const USER_A_ID  = randomUUID(); // member of ORG_A only
const USER_AB_ID = randomUUID(); // member of both orgs
const NOTE_ID    = randomUUID();

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set — cannot run Postgres integration tests");

  sql = postgres(url, { max: 1, prepare: false });

  // Seed auth.users (required by FK in users table)
  await sql.unsafe(`
    INSERT INTO auth.users (id, email) VALUES
      ('${USER_A_ID}',  'user-a@test.com'),
      ('${USER_AB_ID}', 'user-ab@test.com')
    ON CONFLICT (id) DO NOTHING;
  `);

  // Seed users
  await sql.unsafe(`
    INSERT INTO users (id, email) VALUES
      ('${USER_A_ID}',  'user-a@test.com'),
      ('${USER_AB_ID}', 'user-ab@test.com')
    ON CONFLICT (id) DO NOTHING;
  `);

  // Seed orgs
  await sql.unsafe(`
    INSERT INTO orgs (id, name, slug, created_by) VALUES
      ('${ORG_A_ID}', 'Org A', 'org-a-${ORG_A_ID.slice(0,8)}', '${USER_A_ID}'),
      ('${ORG_B_ID}', 'Org B', 'org-b-${ORG_B_ID.slice(0,8)}', '${USER_AB_ID}')
    ON CONFLICT (id) DO NOTHING;
  `);

  // Seed memberships
  await sql.unsafe(`
    INSERT INTO memberships (org_id, user_id, role) VALUES
      ('${ORG_A_ID}', '${USER_A_ID}',  'member'),
      ('${ORG_A_ID}', '${USER_AB_ID}', 'admin'),
      ('${ORG_B_ID}', '${USER_AB_ID}', 'viewer')
    ON CONFLICT DO NOTHING;
  `);

  // Setup shared mocks
  vi.mocked(getDriver).mockReturnValue({} as never);
  vi.mocked(isStale).mockReturnValue(false);
  vi.mocked(syncNode).mockResolvedValue(undefined);
  vi.mocked(getNodeNeighborhood).mockResolvedValue({
    nodes: [{ id: NOTE_ID, type: "Note" as const, label: "Test", properties: { orgId: ORG_A_ID } }],
    links: [],
    centerNodeId: NOTE_ID,
  });
});

afterAll(async () => {
  if (!sql) return;
  await sql.unsafe(`DELETE FROM memberships WHERE org_id IN ('${ORG_A_ID}', '${ORG_B_ID}')`);
  await sql.unsafe(`DELETE FROM orgs        WHERE id       IN ('${ORG_A_ID}', '${ORG_B_ID}')`);
  await sql.unsafe(`DELETE FROM users       WHERE id       IN ('${USER_A_ID}', '${USER_AB_ID}')`);
  await sql.unsafe(`DELETE FROM auth.users  WHERE id       IN ('${USER_A_ID}', '${USER_AB_ID}')`);
  await sql.end();
});

// --- getMembership against real Postgres ---

describe("getMembership — real Postgres", () => {
  it("returns the role for an org member", async () => {
    const result = await getMembership(ORG_A_ID, USER_A_ID);
    expect(result).toEqual({ role: "member" });
  });

  it("returns admin role when user has admin", async () => {
    const result = await getMembership(ORG_A_ID, USER_AB_ID);
    expect(result).toEqual({ role: "admin" });
  });

  it("returns viewer role for second org", async () => {
    const result = await getMembership(ORG_B_ID, USER_AB_ID);
    expect(result).toEqual({ role: "viewer" });
  });

  it("returns null for non-member", async () => {
    const result = await getMembership(ORG_B_ID, USER_A_ID);
    expect(result).toBeNull();
  });

  it("cross-org: USER_A_ID is member of ORG_A but not ORG_B", async () => {
    const inA = await getMembership(ORG_A_ID, USER_A_ID);
    const inB = await getMembership(ORG_B_ID, USER_A_ID);
    expect(inA).not.toBeNull();
    expect(inB).toBeNull();
  });
});

// --- Route gate with real getMembership ---

function makeReq(orgId: string) {
  const params = new URLSearchParams({ orgId });
  return new NextRequest(`http://localhost/api/graph/node/Note/${NOTE_ID}?${params}`);
}

function mockSupabaseUser(userId: string) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
  } as never);
}

describe("GET /api/graph/node — gate with real getMembership + real Postgres", () => {
  it("200 for a member of the requested org", async () => {
    mockSupabaseUser(USER_A_ID);
    const res = await GET(makeReq(ORG_A_ID), { params: Promise.resolve({ type: "Note", id: NOTE_ID }) });
    expect(res.status).toBe(200);
  });

  it("200 for a multi-org user accessing their own org", async () => {
    mockSupabaseUser(USER_AB_ID);
    const res = await GET(makeReq(ORG_B_ID), { params: Promise.resolve({ type: "Note", id: NOTE_ID }) });
    expect(res.status).toBe(200);
  });

  it("403 for a non-member", async () => {
    mockSupabaseUser(USER_A_ID);
    const res = await GET(makeReq(ORG_B_ID), { params: Promise.resolve({ type: "Note", id: NOTE_ID }) });
    expect(res.status).toBe(403);
  });

  it("cross-org: USER_A_ID member of ORG_A, blocked from ORG_B", async () => {
    mockSupabaseUser(USER_A_ID);
    const inA = await GET(makeReq(ORG_A_ID), { params: Promise.resolve({ type: "Note", id: NOTE_ID }) });
    const inB = await GET(makeReq(ORG_B_ID), { params: Promise.resolve({ type: "Note", id: NOTE_ID }) });
    expect(inA.status).toBe(200);
    expect(inB.status).toBe(403);
  });
});
