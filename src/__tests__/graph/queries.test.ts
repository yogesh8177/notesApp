/**
 * Unit tests for Neo4j org-scope filtering in graph queries.
 *
 * The APOC traversal path cannot filter by orgId inline (APOC subgraphAll
 * doesn't support property filters), so org + date filtering is applied in JS
 * via applyFilters after the APOC result returns. These tests cover that path.
 *
 * The fallback Cypher path emits a WHERE clause with orgId — tested by
 * inspecting the Cypher string passed to session.run.
 *
 * Note: a real Neo4j instance is not required; the driver is mocked throughout.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/graph/client", () => ({ getDriver: vi.fn(), ensureIndexes: vi.fn() }));
vi.mock("@/lib/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { getNodeNeighborhood, getNodePreview } from "@/lib/graph/queries";
import { getDriver } from "@/lib/graph/client";

const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_B = "bbbbbbbb-0000-0000-0000-000000000002";

// Minimal neo4j-style node shape used by buildGraphData
function makeNode(id: string, label: string, orgId?: string, elementId?: string) {
  return {
    labels: [label],
    properties: { id, orgId, createdAt: "2026-01-01T00:00:00Z" },
    elementId: elementId ?? id,
  };
}

function makeRel(type: string, startId: string, endId: string) {
  return {
    type,
    properties: {},
    startNodeElementId: startId,
    endNodeElementId: endId,
  };
}

function makeApocRecord(nodes: unknown[], rels: unknown[]) {
  return {
    records: [{ get: (key: string) => (key === "nodes" ? nodes : rels) }],
  };
}

function makeSession(apocResult: unknown, fallbackResult?: unknown) {
  let callCount = 0;
  return {
    run: vi.fn().mockImplementation(() => {
      callCount++;
      // First call is APOC; second (if APOC throws) is fallback
      if (callCount === 1) return Promise.resolve(apocResult);
      return Promise.resolve(fallbackResult ?? { records: [] });
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function mockDriver(session: ReturnType<typeof makeSession>) {
  vi.mocked(getDriver).mockReturnValue({ session: () => session } as never);
}

describe("getNodeNeighborhood — org scoping (APOC path, JS filter)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns null when Neo4j driver is not configured", async () => {
    vi.mocked(getDriver).mockReturnValue(null);
    const result = await getNodeNeighborhood("Note", "n1");
    expect(result).toBeNull();
  });

  it("includes all nodes when no orgId is provided", async () => {
    const center = makeNode("n1", "Note", ORG_A, "e1");
    const other = makeNode("n2", "Note", ORG_B, "e2");
    const session = makeSession(makeApocRecord([center, other], []));
    mockDriver(session);

    const result = await getNodeNeighborhood("Note", "n1");
    expect(result?.nodes.map((n) => n.id)).toContain("n2");
  });

  it("drops neighbors whose orgId differs from the requested org", async () => {
    const center = makeNode("n1", "Note", ORG_A, "e1");
    const sameOrg = makeNode("n2", "Note", ORG_A, "e2");
    const otherOrg = makeNode("n3", "Note", ORG_B, "e3");
    const session = makeSession(makeApocRecord([center, sameOrg, otherOrg], []));
    mockDriver(session);

    const result = await getNodeNeighborhood("Note", "n1", 2, 50, { orgId: ORG_A });
    const ids = result?.nodes.map((n) => n.id) ?? [];
    expect(ids).toContain("n1");   // center always kept
    expect(ids).toContain("n2");   // same org — kept
    expect(ids).not.toContain("n3"); // different org — dropped
  });

  it("keeps User neighbors even when their orgId differs (cross-org user exemption)", async () => {
    const center = makeNode("n1", "Note", ORG_A, "e1");
    // User node synced in orgB context — should still appear in orgA's graph
    const user = makeNode("u1", "User", ORG_B, "e_u1");
    const session = makeSession(makeApocRecord([center, user], []));
    mockDriver(session);

    const result = await getNodeNeighborhood("Note", "n1", 2, 50, { orgId: ORG_A });
    const ids = result?.nodes.map((n) => n.id) ?? [];
    expect(ids).toContain("u1");
  });

  it("keeps User neighbors that have no orgId at all", async () => {
    const center = makeNode("n1", "Note", ORG_A, "e1");
    const userNoOrg = { labels: ["User"], properties: { id: "u2" }, elementId: "e_u2" };
    const session = makeSession(makeApocRecord([center, userNoOrg], []));
    mockDriver(session);

    const result = await getNodeNeighborhood("Note", "n1", 2, 50, { orgId: ORG_A });
    expect(result?.nodes.map((n) => n.id)).toContain("u2");
  });

  it("strips links whose endpoints were filtered out", async () => {
    const center = makeNode("n1", "Note", ORG_A, "e1");
    const dropped = makeNode("n3", "Note", ORG_B, "e3");
    const rel = makeRel("HAS_TAG", "e1", "e3");
    const session = makeSession(makeApocRecord([center, dropped], [rel]));
    mockDriver(session);

    const result = await getNodeNeighborhood("Note", "n1", 2, 50, { orgId: ORG_A });
    expect(result?.links).toHaveLength(0);
  });

  it("returns null when APOC and fallback both find no matching center node", async () => {
    // APOC returns no records (center not found or wrong org); fallback also empty
    const session = makeSession({ records: [] }, { records: [] });
    // Force APOC to fail so fallback runs, then fallback finds nothing
    session.run
      .mockRejectedValueOnce(new Error("APOC unavailable"))
      .mockResolvedValueOnce({ records: [] }) // fallback main query
      .mockResolvedValueOnce({ records: [] }); // fallback center-only query
    mockDriver(session);

    const result = await getNodeNeighborhood("Note", "nonexistent", 2, 50, { orgId: ORG_A });
    expect(result).toBeNull();
  });
});

describe("getNodeNeighborhood — fallback Cypher contains orgId filter", () => {
  beforeEach(() => vi.resetAllMocks());

  it("emits orgId in the WHERE clause when orgId is provided", async () => {
    const session = {
      run: vi.fn()
        .mockRejectedValueOnce(new Error("APOC unavailable")) // force fallback
        .mockResolvedValue({ records: [] }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mockDriver(session as never);

    await getNodeNeighborhood("Note", "n1", 2, 50, { orgId: ORG_A });

    // Find the fallback call (second run call after APOC throws)
    const calls = vi.mocked(session.run).mock.calls;
    const fallbackCall = calls.find(([cypher]) =>
      typeof cypher === "string" && cypher.includes("OPTIONAL MATCH")
    );
    expect(fallbackCall).toBeDefined();
    const [cypher, params] = fallbackCall!;
    expect(cypher).toContain("neighbor.orgId");
    expect(params).toMatchObject({ orgId: ORG_A });
  });

  it("omits orgId from WHERE clause when no orgId is provided", async () => {
    const session = {
      run: vi.fn()
        .mockRejectedValueOnce(new Error("APOC unavailable"))
        .mockResolvedValue({ records: [] }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mockDriver(session as never);

    await getNodeNeighborhood("Note", "n1");

    const calls = vi.mocked(session.run).mock.calls;
    const fallbackCall = calls.find(([cypher]) =>
      typeof cypher === "string" && cypher.includes("OPTIONAL MATCH")
    );
    expect(fallbackCall).toBeDefined();
    const [cypher] = fallbackCall!;
    expect(cypher).not.toContain("neighbor.orgId");
  });
});

describe("getNodePreview", () => {
  beforeEach(() => vi.resetAllMocks());

  it("threads orgId into the underlying neighborhood query", async () => {
    const center = makeNode("n1", "Note", ORG_A, "e1");
    const session = makeSession(makeApocRecord([center], []));
    mockDriver(session);

    await getNodePreview("Note", "n1", ORG_A);

    const [, params] = vi.mocked(session.run).mock.calls[0];
    expect(params).toMatchObject({ orgId: ORG_A });
  });

  it("works without orgId (backwards compat for non-security callers)", async () => {
    const center = makeNode("n1", "Note", ORG_A, "e1");
    const session = makeSession(makeApocRecord([center], []));
    mockDriver(session);

    const result = await getNodePreview("Note", "n1");
    expect(result).not.toBeNull();
  });
});
