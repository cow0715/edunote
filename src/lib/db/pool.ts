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
