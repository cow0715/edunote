import 'server-only'
import { Pool } from 'pg'
import { attachDatabasePool } from '@vercel/functions'
import { poolConfig } from './pool-config'

const globalDb = globalThis as typeof globalThis & { edunotePool?: Pool }

export function getPool() {
  if (globalDb.edunotePool) return globalDb.edunotePool
  const pool = new Pool(poolConfig(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT))
  pool.on('error', () => console.error('[database pool] idle connection failed'))
  attachDatabasePool(pool)
  globalDb.edunotePool = pool
  return pool
}

/** Prepare one connection while the authorized grade GET loads its REST data.
 * No identity is cached, no query runs, and failures cannot prevent the page loading.
 */
export async function warmDatabaseConnection() {
  try {
    const pool = getPool()
    // An idle or connecting/busy client already exists; never fill the pool speculatively.
    if (pool.totalCount > 0) return
    const client = await pool.connect()
    client.release()
  } catch {
    console.warn('[database pool] connection warmup unavailable')
  }
}
