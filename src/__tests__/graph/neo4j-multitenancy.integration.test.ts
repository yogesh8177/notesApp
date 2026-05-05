/**
 * Neo4j multi-tenancy integration tests.
 *
 * These tests run against a real Neo4j instance (bolt://localhost:7687 in CI,
 * or whatever NEO4J_URI is set to locally). They verify that the Cypher
 * executed by getNodeNeighborhood actually filters cross-org data — the gap
 * that unit tests with mocked drivers cannot cover.
 *
 * Run locally:
 *   NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=password \
 *   npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import neo4j, { type Driver, type Session } from "neo4j-driver";

// Import after setup-integration has seeded env vars.
import { getNodeNeighborhood, getNodePreview } from "@/lib/graph/queries";

// Fixed UUIDs for test isolation — cleaned up in afterEach.
const ORG_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const NOTE_A1 = "00000001-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const NOTE_A2 = "00000002-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const NOTE_B1 = "00000001-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const TAG_A   = "0000ta01-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const TAG_B   = "0000tb01-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const USER_ID = "0000u001-cccc-4ccc-cccc-cccccccccccc";

const TEST_IDS = [NOTE_A1, NOTE_A2, NOTE_B1, TAG_A, TAG_B, USER_ID];

let driver: Driver;

beforeAll(async () => {
  const uri = process.env.NEO4J_URI;
  if (!uri) throw new Error("NEO4J_URI not set — cannot run Neo4j integration tests");

  driver = neo4j.driver(
    uri,
    neo4j.auth.basic(process.env.NEO4J_USER ?? "neo4j", process.env.NEO4J_PASSWORD ?? ""),
  );
  await driver.verifyConnectivity();

  // Wire in the driver so getDriver() returns this instance.
  // We set the env var so client.ts initialises its singleton to our test instance.
  process.env.NEO4J_URI      = uri;
  process.env.NEO4J_USER     = process.env.NEO4J_USER ?? "neo4j";
  process.env.NEO4J_PASSWORD = process.env.NEO4J_PASSWORD ?? "";
});

afterAll(async () => {
  await driver?.close();
});

afterEach(async () => {
  const s = driver.session();
  try {
    await s.run(
      `MATCH (n) WHERE n.id IN $ids DETACH DELETE n`,
      { ids: TEST_IDS },
    );
  } finally {
    await s.close();
  }
});

/** Seed two orgs with notes, tags, and a shared user into Neo4j directly. */
async function seedTwoOrgs(s: Session) {
  await s.run(
    `
    MERGE (na1:Note {id: $na1}) SET na1.orgId = $orgA, na1.title = 'Note A1', na1.createdAt = '2026-01-01T00:00:00Z'
    MERGE (na2:Note {id: $na2}) SET na2.orgId = $orgA, na2.title = 'Note A2', na2.createdAt = '2026-01-02T00:00:00Z'
    MERGE (nb1:Note {id: $nb1}) SET nb1.orgId = $orgB, nb1.title = 'Note B1', nb1.createdAt = '2026-01-01T00:00:00Z'
    MERGE (ta:Tag  {id: $ta})   SET ta.orgId  = $orgA, ta.name   = 'tagA'
    MERGE (tb:Tag  {id: $tb})   SET tb.orgId  = $orgB, tb.name   = 'tagB'
    MERGE (u:User  {id: $u})    SET u.email   = 'shared@test.com'
    MERGE (na1)-[:HAS_TAG]->(ta)
    MERGE (nb1)-[:HAS_TAG]->(tb)
    MERGE (u)-[:AUTHORED]->(na1)
    MERGE (u)-[:AUTHORED]->(nb1)
    MERGE (na1)-[:RELATED_TO]->(na2)
    MERGE (na1)-[:RELATED_TO]->(nb1)
    `,
    { na1: NOTE_A1, na2: NOTE_A2, nb1: NOTE_B1, ta: TAG_A, tb: TAG_B, u: USER_ID, orgA: ORG_A, orgB: ORG_B },
  );
}

describe("getNodeNeighborhood — real Neo4j, org scoping", () => {
  it("returns null when driver is not available", async () => {
    // Temporarily unset so getDriver() returns null
    const saved = process.env.NEO4J_URI;
    delete process.env.NEO4J_URI;
    // Reset the singleton so it re-checks the env var
    const { _resetDriver } = await import("@/lib/graph/client");
    if (_resetDriver) _resetDriver();
    const result = await getNodeNeighborhood("Note", NOTE_A1);
    expect(result).toBeNull();
    process.env.NEO4J_URI = saved;
  });

  it("includes same-org Note neighbors and excludes cross-org Note neighbors", async () => {
    const s = driver.session();
    try {
      await seedTwoOrgs(s);
    } finally {
      await s.close();
    }

    const result = await getNodeNeighborhood("Note", NOTE_A1, 2, 50, { orgId: ORG_A });
    expect(result).not.toBeNull();
    const ids = result!.nodes.map((n) => n.id);

    expect(ids).toContain(NOTE_A1); // center — always present
    expect(ids).toContain(NOTE_A2); // same org neighbor
    expect(ids).toContain(TAG_A);   // same org tag
    expect(ids).not.toContain(NOTE_B1); // different org — must be excluded
    expect(ids).not.toContain(TAG_B);   // different org tag — must be excluded
  });

  it("includes User neighbors regardless of orgId (cross-org entity exemption)", async () => {
    const s = driver.session();
    try {
      await seedTwoOrgs(s);
    } finally {
      await s.close();
    }

    const result = await getNodeNeighborhood("Note", NOTE_A1, 2, 50, { orgId: ORG_A });
    expect(result).not.toBeNull();
    const ids = result!.nodes.map((n) => n.id);

    // User authored notes in both orgs — must still appear when viewing orgA
    expect(ids).toContain(USER_ID);
  });

  it("strips links whose target was filtered out", async () => {
    const s = driver.session();
    try {
      await seedTwoOrgs(s);
    } finally {
      await s.close();
    }

    const result = await getNodeNeighborhood("Note", NOTE_A1, 2, 50, { orgId: ORG_A });
    expect(result).not.toBeNull();

    // The RELATED_TO edge from NOTE_A1 → NOTE_B1 must not appear since NOTE_B1 is filtered
    const crossOrgLinks = result!.links.filter(
      (l) => l.source === NOTE_B1 || l.target === NOTE_B1,
    );
    expect(crossOrgLinks).toHaveLength(0);
  });

  it("returns null when center node belongs to a different org than requested", async () => {
    const s = driver.session();
    try {
      await seedTwoOrgs(s);
    } finally {
      await s.close();
    }

    // NOTE_B1 belongs to ORG_B; querying with ORG_A → center MATCH fails → null
    const result = await getNodeNeighborhood("Note", NOTE_B1, 2, 50, { orgId: ORG_A });
    expect(result).toBeNull();
  });

  it("returns all neighbors when no orgId is provided (no scoping)", async () => {
    const s = driver.session();
    try {
      await seedTwoOrgs(s);
    } finally {
      await s.close();
    }

    const result = await getNodeNeighborhood("Note", NOTE_A1, 2, 50);
    expect(result).not.toBeNull();
    const ids = result!.nodes.map((n) => n.id);

    // Without orgId filter, cross-org neighbor NOTE_B1 is reachable via RELATED_TO
    expect(ids).toContain(NOTE_A1);
    expect(ids).toContain(NOTE_B1);
  });

  it("getNodePreview respects orgId (depth-1 hover preview)", async () => {
    const s = driver.session();
    try {
      await seedTwoOrgs(s);
    } finally {
      await s.close();
    }

    const result = await getNodePreview("Note", NOTE_A1, ORG_A);
    expect(result).not.toBeNull();
    const ids = result!.nodes.map((n) => n.id);
    expect(ids).not.toContain(NOTE_B1);
    expect(ids).not.toContain(TAG_B);
  });
});
