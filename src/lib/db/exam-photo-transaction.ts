import 'server-only'
import type { PreparedReadingRow } from '@/lib/atomic-grade'
import { getPool } from './pool'
import { finalizeExamPhotoBatch } from './exam-photo-finalize'

export async function saveExamPhotoFinalization(
  userId: string, teacherId: string, weekId: string, jobId: string, rows: PreparedReadingRow[],
) {
  const client = await getPool().connect()
  let committing = false
  let destroy = false
  try {
    await client.query('begin')
    await client.query(
      `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true),
              set_config('statement_timeout', '10000', true), set_config('lock_timeout', '3000', true),
              set_config('idle_in_transaction_session_timeout', '10000', true)`,
      [JSON.stringify({ sub: userId }), userId],
    )
    const result = await finalizeExamPhotoBatch(client, teacherId, weekId, jobId, rows)
    committing = true
    await client.query('commit')
    return result
  } catch (error) {
    destroy = committing
    try { await client.query('rollback') } catch { destroy = true }
    throw error
  } finally {
    client.release(destroy)
  }
}
