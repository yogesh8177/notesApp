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

import { db } from '@/lib/db/client'
import { notes, agentSessions, auditLog, orgs } from '@/lib/db/schema'
import { syncNode } from '@/lib/graph/sync'
import { eq, desc } from 'drizzle-orm'

async function main() {
  const orgFlagIdx = process.argv.indexOf('--org')
  const orgFlag =
    process.argv.find(a => a.startsWith('--org='))?.split('=')[1] ??
    (orgFlagIdx !== -1 && process.argv[orgFlagIdx + 1] && !process.argv[orgFlagIdx + 1].startsWith('--')
      ? process.argv[orgFlagIdx + 1]
      : undefined)

  let orgIds: string[]
  if (orgFlag) {
    orgIds = [orgFlag]
    console.log(`Syncing org: ${orgFlag}`)
  } else {
    const allOrgs = await db.select({ id: orgs.id }).from(orgs)
    orgIds = allOrgs.map(o => o.id)
    console.log(`Syncing ${orgIds.length} org(s)`)
  }

  for (const orgId of orgIds) {
    console.log(`\n── Org ${orgId} ──`)

    // Sync notes
    const noteRows = await db.select({ id: notes.id }).from(notes).where(eq(notes.orgId, orgId))
    console.log(`  Notes: ${noteRows.length}`)
    for (const row of noteRows) {
      await syncNode('Note', row.id, orgId)
      process.stdout.write('.')
    }
    console.log()

    // Sync agent sessions
    const sessionRows = await db
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .where(eq(agentSessions.orgId, orgId))
    console.log(`  Sessions: ${sessionRows.length}`)
    for (const row of sessionRows) {
      await syncNode('AgentSession', row.id, orgId)
      process.stdout.write('.')
    }
    console.log()

    // Sync recent audit events (last 1000)
    const auditRows = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.orgId, orgId))
      .orderBy(desc(auditLog.createdAt))
      .limit(1000)
    console.log(`  Audit events: ${auditRows.length}`)
    for (const row of auditRows) {
      await syncNode('AuditEvent', String(row.id), orgId)
      process.stdout.write('.')
    }
    console.log()
  }

  console.log('\nSync complete.')
}

main().catch(e => { console.error(e); process.exit(1) })
