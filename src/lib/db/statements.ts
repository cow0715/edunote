import 'server-only'
import { sql, type SQL } from 'drizzle-orm'
import type { DbTransaction } from './transaction'
import { SaveError } from './errors'

// Internal persistence plans only: never accept a table, column or SQL from HTTP input.
type Table = 'week' | 'week_score' | 'student_answer' | 'student_vocab_answer'
  | 'vocab_word' | 'vocab_word_variant' | 'vocab_test' | 'vocab_test_item'
  | 'student' | 'class_student' | 'clinic_enrollment' | 'mock_exam_result' | 'mock_exam_student_answer'
  | 'exam_question' | 'exam_question_tag' | 'mock_exam' | 'mock_exam_question'
  | 'mock_exam_report' | 'vocab_variant_cache'
export type RecordValues = Record<string, unknown>
export type Statement = { query: SQL; required?: boolean }
const tableName = (table: Table) => sql`${sql.identifier('public')}.${sql.identifier(table)}`

export function insertRows(table: Table, rows: RecordValues[], conflict: string[] = []): Statement[] {
  // Group by columns so an omitted field keeps its DB default / previous value.
  const groups = new Map<string, RecordValues[]>()
  for (const row of rows) {
    const key = JSON.stringify(Object.keys(row).filter(k => row[k] !== undefined).sort())
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const result: Statement[] = []
  for (const [key, group] of groups) {
    const columns = JSON.parse(key) as string[]
    for (let offset = 0; offset < group.length; offset += 100) {
      const batch = group.slice(offset, offset + 100)
      // jsonb_populate_record preserves PostgreSQL arrays and JSON objects without
      // relying on node-postgres' different array/object parameter conversions.
      const values = sql.join(columns.map(k => sql`r.${sql.identifier(k)}`), sql`, `)
      const updates = columns.filter(k => k !== 'id' && !conflict.includes(k))
      const onConflict = conflict.length ? sql`on conflict (${sql.join(conflict.map(k => sql.identifier(k)), sql`, `)}) ${updates.length
        ? sql`do update set ${sql.join(updates.map(k => sql`${sql.identifier(k)} = excluded.${sql.identifier(k)}`), sql`, `)}`
        : sql`do nothing`}` : sql``
      result.push({ query: sql`insert into ${tableName(table)} (${sql.join(columns.map(k => sql.identifier(k)), sql`, `)})
        select ${values} from jsonb_populate_recordset(null::${tableName(table)}, ${JSON.stringify(batch)}::jsonb) r ${onConflict}` })
    }
  }
  return result
}

export function updateRows(table: Table, patch: RecordValues, where: SQL, required = false): Statement {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined)
  return { query: sql`update ${tableName(table)} set ${sql.join(entries.map(([key, value]) =>
    sql`${sql.identifier(key)} = (jsonb_populate_record(null::${tableName(table)}, ${JSON.stringify({ [key]: value })}::jsonb)).${sql.identifier(key)}`), sql`, `)} where ${where} returning id`, required }
}

export function deleteRows(table: Table, where: SQL): Statement {
  return { query: sql`delete from ${tableName(table)} where ${where}` }
}

export async function executeStatements(tx: DbTransaction, statements: Statement[]) {
  for (const statement of statements) {
    const result = await tx.execute(statement.query)
    if (statement.required && result.rows.length === 0) throw new SaveError('자료가 변경됐습니다. 새로고침 후 다시 시도해 주세요.', 409)
  }
}
