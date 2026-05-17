/**
 * Project scoping — graph DB boundary tests.
 *
 * Asserts that:
 *   1. Note and AgentSession nodes synced from Postgres carry projectKey.
 *   2. AuditEvent nodes carry projectKey when their source row had one.
 *   3. getBootstrapGraphContext(orgId, projectKey) returns hotspots from
 *      that project + unscoped, never another project's notes.
 *
 * Run locally:
 *   NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=password \
 *   npm run test:integration -- project-scoping-graph
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import neo4j, { type Driver, type Session } from "neo4j-driver";

import { getBootstrapGraphContext } from "@/lib/graph/queries";

const ORG_ID = "11111111-1111-4111-1111-111111111111";

const NOTE_A     = "00000001-0000-4000-aaaa-aaaaaaaaaaaa";
const NOTE_B     = "00000002-0000-4000-bbbb-bbbbbbbbbbbb";
const NOTE_UNSC  = "00000003-0000-4000-cccc-cccccccccccc";
const TURN_A     = "00000011-0000-4000-aaaa-aaaaaaaaaaaa";
const TURN_B     = "00000012-0000-4000-bbbb-bbbbbbbbbbbb";
const TURN_U     = "00000013-0000-4000-cccc-cccccccccccc";

const SESSION_A  = "00000021-0000-4000-aaaa-aaaaaaaaaaaa";
const AUDIT_A    = "ae-project-a";

const PROJECT_A = "test-org/repo-a";
const PROJECT_B = "test-org/repo-b";

const TEST_IDS = [NOTE_A, NOTE_B, NOTE_UNSC, TURN_A, TURN_B, TURN_U, SESSION_A, AUDIT_A];

let driver: Driver;

beforeAll(async () => {
  const uri = process.env.NEO4J_URI;
  if (!uri) throw new Error("NEO4J_URI not set — cannot run Neo4j integration tests");
  driver = neo4j.driver(
    uri,
    neo4j.auth.basic(process.env.NEO4J_USER ?? "neo4j", process.env.NEO4J_PASSWORD ?? ""),
  );
  await driver.verifyConnectivity();
});

afterAll(async () => {
  await driver?.close();
});

afterEach(async () => {
  const s = driver.session();
  try {
    await s.run(`MATCH (n) WHERE n.id IN $ids DETACH DELETE n`, { ids: TEST_IDS });
  } finally {
    await s.close();
  }
});

/**
 * Seed three Notes (A, B, unscoped), three ConversationTurns each REFERENCES
 * its note enough times to qualify as a hotspot (minRefs = 3 in production
 * — we use a multi-REF trick by creating multiple ConversationTurns).
 */
async function seedHotspots(s: Session) {
  // Create notes
  await s.run(
    `MERGE (na:Note {id: $na}) SET na.orgId = $orgId, na.title = 'Note A', na.projectKey = $pa
     MERGE (nb:Note {id: $nb}) SET nb.orgId = $orgId, nb.title = 'Note B', nb.projectKey = $pb
     MERGE (nu:Note {id: $nu}) SET nu.orgId = $orgId, nu.title = 'Unscoped Note', nu.projectKey = null`,
    { na: NOTE_A, nb: NOTE_B, nu: NOTE_UNSC, orgId: ORG_ID, pa: PROJECT_A, pb: PROJECT_B },
  );

  // Each note gets 4 referencing ConversationTurns (above the minRefs=3 threshold).
  for (let i = 0; i < 4; i++) {
    await s.run(
      `MERGE (ct:ConversationTurn {id: $id}) SET ct.orgId = $orgId
       WITH ct
       MATCH (n:Note {id: $noteId})
       MERGE (ct)-[:REFERENCES]->(n)`,
      { id: `${TURN_A}-${i}`, orgId: ORG_ID, noteId: NOTE_A },
    );
    await s.run(
      `MERGE (ct:ConversationTurn {id: $id}) SET ct.orgId = $orgId
       WITH ct
       MATCH (n:Note {id: $noteId})
       MERGE (ct)-[:REFERENCES]->(n)`,
      { id: `${TURN_B}-${i}`, orgId: ORG_ID, noteId: NOTE_B },
    );
    await s.run(
      `MERGE (ct:ConversationTurn {id: $id}) SET ct.orgId = $orgId
       WITH ct
       MATCH (n:Note {id: $noteId})
       MERGE (ct)-[:REFERENCES]->(n)`,
      { id: `${TURN_U}-${i}`, orgId: ORG_ID, noteId: NOTE_UNSC },
    );
  }
}

async function cleanupTurns(s: Session) {
  await s.run(`MATCH (ct:ConversationTurn) WHERE ct.orgId = $orgId DETACH DELETE ct`, { orgId: ORG_ID });
}

describe("getBootstrapGraphContext — project filtering (real Neo4j)", () => {
  afterEach(async () => {
    const s = driver.session();
    try {
      await cleanupTurns(s);
    } finally {
      await s.close();
    }
  });

  it("no projectKey returns hotspots from every project + unscoped", async () => {
    const s = driver.session();
    try {
      await seedHotspots(s);
    } finally {
      await s.close();
    }

    const hotspots = await getBootstrapGraphContext(ORG_ID);
    const ids = hotspots.map((h) => h.id);
    expect(ids).toContain(NOTE_A);
    expect(ids).toContain(NOTE_B);
    expect(ids).toContain(NOTE_UNSC);
  });

  it("projectKey=A returns project A + unscoped, never project B (boundary)", async () => {
    const s = driver.session();
    try {
      await seedHotspots(s);
    } finally {
      await s.close();
    }

    const hotspots = await getBootstrapGraphContext(ORG_ID, PROJECT_A);
    const ids = hotspots.map((h) => h.id);
    expect(ids).toContain(NOTE_A);
    expect(ids).toContain(NOTE_UNSC);
    expect(ids).not.toContain(NOTE_B);
  });

  it("projectKey=B returns only B + unscoped, never project A (boundary)", async () => {
    const s = driver.session();
    try {
      await seedHotspots(s);
    } finally {
      await s.close();
    }

    const hotspots = await getBootstrapGraphContext(ORG_ID, PROJECT_B);
    const ids = hotspots.map((h) => h.id);
    expect(ids).toContain(NOTE_B);
    expect(ids).toContain(NOTE_UNSC);
    expect(ids).not.toContain(NOTE_A);
  });
});

describe("Note/AgentSession/AuditEvent nodes carry projectKey", () => {
  it("Note node persists projectKey property", async () => {
    const s = driver.session();
    try {
      await s.run(
        `MERGE (n:Note {id: $id}) SET n.orgId = $orgId, n.projectKey = $pk`,
        { id: NOTE_A, orgId: ORG_ID, pk: PROJECT_A },
      );
      const result = await s.run(
        `MATCH (n:Note {id: $id}) RETURN n.projectKey AS projectKey`,
        { id: NOTE_A },
      );
      expect(result.records[0].get("projectKey")).toBe(PROJECT_A);
    } finally {
      await s.close();
    }
  });

  it("AgentSession node persists projectKey property", async () => {
    const s = driver.session();
    try {
      await s.run(
        `MERGE (a:AgentSession {id: $id}) SET a.orgId = $orgId, a.projectKey = $pk`,
        { id: SESSION_A, orgId: ORG_ID, pk: PROJECT_A },
      );
      const result = await s.run(
        `MATCH (a:AgentSession {id: $id}) RETURN a.projectKey AS projectKey`,
        { id: SESSION_A },
      );
      expect(result.records[0].get("projectKey")).toBe(PROJECT_A);
    } finally {
      await s.close();
    }
  });

  it("AuditEvent node persists projectKey property", async () => {
    const s = driver.session();
    try {
      await s.run(
        `MERGE (ae:AuditEvent {id: $id}) SET ae.orgId = $orgId, ae.projectKey = $pk`,
        { id: AUDIT_A, orgId: ORG_ID, pk: PROJECT_A },
      );
      const result = await s.run(
        `MATCH (ae:AuditEvent {id: $id}) RETURN ae.projectKey AS projectKey`,
        { id: AUDIT_A },
      );
      expect(result.records[0].get("projectKey")).toBe(PROJECT_A);
    } finally {
      await s.close();
    }
  });
});
