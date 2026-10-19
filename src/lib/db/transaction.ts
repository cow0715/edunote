import 'server-only'
import { and, eq } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { getPool } from './pool'
import * as schema from './schema'
import { SaveError } from './errors'

export type DbTransaction = Omit<NodePgDatabase<typeof schema>, 'transaction' | '$client'>
export interface TeacherTransaction {
  tx: DbTransaction
  teacherId: string
}

/** userId must come from server-verified Auth.getUser(), never request JSON. */
export async function withTeacherTransaction<T>(userId: string, work: (context: TeacherTransaction) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  let destroy = false
  let committing = false
  try {
    await client.query('BEGIN')
    // SET LOCAL is released by both COMMIT and ROLLBACK under transaction pooling.
    await client.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('statement_timeout', '10000', true), set_config('lock_timeout', '3000', true), set_config('idle_in_transaction_session_timeout', '10000', true), set_config('search_path', 'public, extensions', true)", [JSON.stringify({ sub: userId }), userId])
    const tx = drizzle(client, { schema })
    const [teacher] = await tx.select({ id: schema.teachers.id }).from(schema.teachers)
      .where(and(eq(schema.teachers.auth_id, userId), eq(schema.teachers.approval_status, 'approved')))
    if (!teacher) throw new SaveError('승인된 강사만 변경할 수 있습니다.', 403)
    const result = await work({ tx, teacherId: teacher.id })
    committing = true
    await client.query('COMMIT')
    committing = false
    return result
  } catch (error) {
    // Even if ROLLBACK succeeds, don't reuse a connection after an ambiguous COMMIT.
    if (committing) destroy = true
    try { await client.query('ROLLBACK') } catch { destroy = true }
    // No automatic retry: a lost COMMIT response may already have committed.
    throw error
  } finally {
    client.release(destroy)
  }
}

export async function lockClass({ tx, teacherId }: TeacherTransaction, classId: string) {
  const [row] = await tx.select().from(schema.classes)
    .where(and(eq(schema.classes.id, classId), eq(schema.classes.teacher_id, teacherId))).for('update')
  if (!row) throw new SaveError('접근 권한이 없거나 반을 찾을 수 없습니다.', 403)
  return row
}
