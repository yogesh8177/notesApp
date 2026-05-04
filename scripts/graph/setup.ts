import * as fs from 'fs'
import * as path from 'path'

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadEnv()

import neo4j from 'neo4j-driver'

async function main() {
  const uri = process.env.NEO4J_URI
  if (!uri) {
    console.error('NEO4J_URI not set. Add it to .env first.')
    process.exit(1)
  }

  const driver = neo4j.driver(
    uri,
    neo4j.auth.basic(
      process.env.NEO4J_USER ?? 'neo4j',
      process.env.NEO4J_PASSWORD ?? ''
    )
  )
  const session = driver.session()
  try {
    const constraints = [
      'CREATE CONSTRAINT note_id IF NOT EXISTS FOR (n:Note) REQUIRE n.id IS UNIQUE',
      'CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE',
      'CREATE CONSTRAINT session_id IF NOT EXISTS FOR (s:AgentSession) REQUIRE s.id IS UNIQUE',
      'CREATE CONSTRAINT turn_id IF NOT EXISTS FOR (t:ConversationTurn) REQUIRE t.id IS UNIQUE',
      'CREATE CONSTRAINT tag_id IF NOT EXISTS FOR (t:Tag) REQUIRE t.id IS UNIQUE',
      'CREATE CONSTRAINT audit_id IF NOT EXISTS FOR (e:AuditEvent) REQUIRE e.id IS UNIQUE',
    ]
    const indexes = [
      'CREATE INDEX note_orgId IF NOT EXISTS FOR (n:Note) ON (n.orgId)',
      'CREATE INDEX user_orgId IF NOT EXISTS FOR (u:User) ON (u.orgId)',
      'CREATE INDEX session_orgId IF NOT EXISTS FOR (s:AgentSession) ON (s.orgId)',
      'CREATE INDEX audit_orgId IF NOT EXISTS FOR (e:AuditEvent) ON (e.orgId)',
      'CREATE INDEX audit_action IF NOT EXISTS FOR (e:AuditEvent) ON (e.action)',
    ]

    for (const stmt of [...constraints, ...indexes]) {
      await session.run(stmt)
      console.log('  ✓', stmt.replace(/CREATE (CONSTRAINT|INDEX)/, '$1').split(' IF')[0])
    }
    console.log('\nNeo4j schema setup complete.')
  } finally {
    await session.close()
    await driver.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
