// Optional multi-connection integration check. Never reads .env or Supabase.
// Install: npm install --prefix tmp/transaction-pg --no-save --package-lock=false embedded-postgres@18.4.0-beta.17
// Run: node scripts/verify-transactions-local.mjs
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const requireLocal = createRequire(resolve('tmp/transaction-pg/package.json'))
const { default: EmbeddedPostgres } = await import(pathToFileURL(requireLocal.resolve('embedded-postgres')).href)

// Choose an available loopback port; PostgreSQL itself remains bound to loopback.
const port = await new Promise((resolvePort, reject) => {
  const server = createServer()
  server.on('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close(() => resolvePort(address.port))
  })
})
const password = randomUUID()
const directory = resolve('tmp/transaction-pg', `cluster-${randomUUID()}`)
const pg = new EmbeddedPostgres({ databaseDir: directory, user: 'postgres', password, port,
  persistent: true, createPostgresUser: false,
  postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {},
})
let started = false
try {
  await pg.initialise()
  await pg.start()
  started = true
  await pg.createDatabase('edunote_tx_test')
  const code = await new Promise((resolveCode, reject) => {
    const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.database.config.ts'], {
      stdio: 'inherit', windowsHide: true,
      env: { ...process.env, LOCAL_TRANSACTION_TEST_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/edunote_tx_test` },
    })
    child.on('error', reject)
    child.on('exit', resolveCode)
  })
  if (code !== 0) process.exitCode = 1
} finally {
  if (started) await pg.stop()
  console.log('Local test cluster stopped. Temporary directory:', directory)
}
// The Windows embedded runner can retain pipe handles after taskkill. All tests
// and the awaited cluster shutdown have finished; terminate this helper only.
process.exit(process.exitCode ?? 0)
