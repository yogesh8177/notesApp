import neo4j, { Driver } from "neo4j-driver";

let _driver: Driver | null = null;

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
      )
    );
  }
  return _driver;
}
