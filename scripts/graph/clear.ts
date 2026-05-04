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

import * as readline from 'readline'
import neo4j from 'neo4j-driver'

async function main() {
  const uri = process.env.NEO4J_URI
  if (!uri) {
    console.error('NEO4J_URI not set.')
    process.exit(1)
  }

  const force = process.argv.includes('--force')

  if (!force) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answer = await new Promise<string>(r =>
      rl.question('Delete ALL graph data? This cannot be undone. [y/N] ', r)
    )
    rl.close()
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('Aborted.')
      process.exit(0)
    }
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
    // Delete in batches to avoid memory issues on large graphs
    let deleted = 0
    while (true) {
      const result = await session.run(
        'MATCH (n) WITH n LIMIT 10000 DETACH DELETE n RETURN count(n) as c'
      )
      const count = result.records[0]?.get('c').toNumber() ?? 0
      deleted += count
      if (count === 0) break
      console.log(`  Deleted ${deleted} nodes so far…`)
    }
    console.log(`\nGraph cleared (${deleted} nodes removed).`)
  } finally {
    await session.close()
    await driver.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
