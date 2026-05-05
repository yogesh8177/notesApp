import neo4j, { Driver } from "neo4j-driver";
import { log } from "@/lib/log";

let _driver: Driver | null = null;
let _indexesReady = false;

/**
 * Neo4j driver singleton.
 * Returns null if NEO4J_URI is not set — graph features degrade gracefully.
 */
export function getDriver(): Driver | null {
  if (!process.env.NEO4J_URI) return null;
  if (!_driver) {
    _driver = neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(
        process.env.NEO4J_USER ?? "neo4j",
        process.env.NEO4J_PASSWORD ?? ""
      ),
      { maxConnectionPoolSize: 20 }
    );
  }
  return _driver;
}

const CONSTRAINTS = [
  "CREATE CONSTRAINT note_id IF NOT EXISTS FOR (n:Note) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT user_id IF NOT EXISTS FOR (n:User) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT tag_id IF NOT EXISTS FOR (n:Tag) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT agent_session_id IF NOT EXISTS FOR (n:AgentSession) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT conversation_turn_id IF NOT EXISTS FOR (n:ConversationTurn) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT audit_event_id IF NOT EXISTS FOR (n:AuditEvent) REQUIRE n.id IS UNIQUE",
];

/** Test helper — clears the driver singleton so tests can change NEO4J_URI mid-run. */
export function _resetDriver(): void {
  _driver = null;
  _indexesReady = false;
}

/** Creates uniqueness constraints (and implicit indexes) for all node types. No-op after first success. */
export async function ensureIndexes(): Promise<void> {
  if (_indexesReady) return;
  const driver = getDriver();
  if (!driver) return;
  const session = driver.session();
  try {
    for (const stmt of CONSTRAINTS) {
      await session.run(stmt);
    }
    _indexesReady = true;
    log.info("graph.indexes.ready");
  } catch (err) {
    log.warn({ err }, "graph.indexes.setup_failed");
  } finally {
    await session.close();
  }
}
