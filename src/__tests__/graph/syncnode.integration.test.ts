/**
 * syncNode write-path integration test.
 *
 * Uses both Postgres and Neo4j simultaneously — the only way to verify that
 * syncNode correctly scopes its Postgres fetch before writing to Neo4j.
 *
 * Key assertion: calling syncNode with the wrong orgId must write nothing to
 * Neo4j. The guard is the `eq(notes.orgId, orgId)` clause in syncNote(); if
 * that clause were removed, the note would be written under the wrong org and
 * these tests would catch it.
 *
 * Run locally:
 *   DATABASE_URL=postgresql://... NEO4J_URI=bolt://localhost:7687 ... \
 *   npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import neo4j, { type Driver } from "neo4j-driver";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

import { syncNode } from "@/lib/graph/sync";

const ORG_A_ID  = randomUUID();
const ORG_B_ID  = randomUUID();
const USER_ID   = randomUUID();
const NOTE_ID   = randomUUID();

let driver: Driver;
let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const dbUrl  = process.env.DATABASE_URL;
  const neo4jUri = process.env.NEO4J_URI;
  if (!dbUrl)    throw new Error("DATABASE_URL not set");
  if (!neo4jUri) throw new Error("NEO4J_URI not set");

  sql = postgres(dbUrl, { max: 1, prepare: false });
  driver = neo4j.driver(
    neo4jUri,
    neo4j.auth.basic(process.env.NEO4J_USER ?? "neo4j", process.env.NEO4J_PASSWORD ?? ""),
  );
  await driver.verifyConnectivity();

  // Seed auth.users (FK target for users table)
  await sql.unsafe(`
    INSERT INTO auth.users (id, email) VALUES ('${USER_ID}', 'synctest@test.com')
    ON CONFLICT (id) DO NOTHING;
  `);
  // Seed users
  await sql.unsafe(`
    INSERT INTO users (id, email) VALUES ('${USER_ID}', 'synctest@test.com')
    ON CONFLICT (id) DO NOTHING;
  `);
  // Seed orgs
  await sql.unsafe(`
    INSERT INTO orgs (id, name, slug, created_by) VALUES
      ('${ORG_A_ID}', 'Sync Org A', 'sync-org-a-${ORG_A_ID.slice(0,8)}', '${USER_ID}'),
      ('${ORG_B_ID}', 'Sync Org B', 'sync-org-b-${ORG_B_ID.slice(0,8)}', '${USER_ID}')
    ON CONFLICT (id) DO NOTHING;
  `);
  // Seed a note under ORG_A
  await sql.unsafe(`
    INSERT INTO notes (id, org_id, author_id, title, content, visibility)
    VALUES ('${NOTE_ID}', '${ORG_A_ID}', '${USER_ID}', 'Sync Test Note', 'body', 'org')
    ON CONFLICT (id) DO NOTHING;
  `);
});

afterAll(async () => {
  // Clean Postgres
  if (sql) {
    await sql.unsafe(`DELETE FROM notes WHERE id = '${NOTE_ID}'`);
    await sql.unsafe(`DELETE FROM orgs  WHERE id IN ('${ORG_A_ID}', '${ORG_B_ID}')`);
    await sql.unsafe(`DELETE FROM users WHERE id = '${USER_ID}'`);
    await sql.unsafe(`DELETE FROM auth.users WHERE id = '${USER_ID}'`);
    await sql.end();
  }
  // Clean Neo4j
  if (driver) {
    const s = driver.session();
    try {
      await s.run(`MATCH (n) WHERE n.id IN [$noteId, $userId] DETACH DELETE n`,
        { noteId: NOTE_ID, userId: USER_ID });
    } finally {
      await s.close();
    }
    await driver.close();
  }
});

async function getNeo4jNode(id: string) {
  const s = driver.session();
  try {
    const result = await s.run(`MATCH (n {id: $id}) RETURN n`, { id });
    if (result.records.length === 0) return null;
    return result.records[0].get("n").properties as Record<string, unknown>;
  } finally {
    await s.close();
  }
}

describe("syncNode write-path — org scoping", () => {
  it("writes nothing to Neo4j when orgId does not match the note's org", async () => {
    // Note belongs to ORG_A; syncing with ORG_B should be a no-op
    await syncNode("Note", NOTE_ID, ORG_B_ID);

    const node = await getNeo4jNode(NOTE_ID);
    expect(node).toBeNull();
  });

  it("writes the note to Neo4j when orgId matches", async () => {
    await syncNode("Note", NOTE_ID, ORG_A_ID);

    const node = await getNeo4jNode(NOTE_ID);
    expect(node).not.toBeNull();
    expect(node!.id).toBe(NOTE_ID);
    expect(node!.orgId).toBe(ORG_A_ID);
    expect(node!.title).toBe("Sync Test Note");
  });

  it("stamped orgId on Note node matches ORG_A, not ORG_B", async () => {
    await syncNode("Note", NOTE_ID, ORG_A_ID);

    const node = await getNeo4jNode(NOTE_ID);
    expect(node!.orgId).toBe(ORG_A_ID);
    expect(node!.orgId).not.toBe(ORG_B_ID);
  });

  it("User node written by syncNode has no orgId (cross-org entity fix)", async () => {
    await syncNode("Note", NOTE_ID, ORG_A_ID);

    const userNode = await getNeo4jNode(USER_ID);
    expect(userNode).not.toBeNull();
    // orgId must not be set — we removed this in the multi-tenancy fix
    // to prevent last-writer-wins corruption across orgs
    expect(userNode!.orgId).toBeUndefined();
    expect(userNode!.email).toBe("synctest@test.com");
  });

  it("re-syncing with wrong org after correct sync does not overwrite the node", async () => {
    // First sync with correct org
    await syncNode("Note", NOTE_ID, ORG_A_ID);
    const before = await getNeo4jNode(NOTE_ID);
    expect(before!.orgId).toBe(ORG_A_ID);

    // Attempt sync with wrong org — Postgres query returns nothing, no write
    await syncNode("Note", NOTE_ID, ORG_B_ID);
    const after = await getNeo4jNode(NOTE_ID);

    // Node must still carry ORG_A's orgId
    expect(after!.orgId).toBe(ORG_A_ID);
  });
});
