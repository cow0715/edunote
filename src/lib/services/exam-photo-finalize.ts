import 'server-only'
import { isDeepStrictEqual } from 'node:util'
import { sql } from 'drizzle-orm'
import { SaveError } from '@/lib/db/errors'
import type { Statement } from '@/lib/db/statements'
import { withTeacherTransaction } from '@/lib/db/transaction'
import type { SavedGradeVersion } from '@/lib/atomic-grade'
import type { GradeRow } from '@/hooks/use-grade'
import { applyGradePlan } from './grade-save'

export async function finalizeExamPhotoJob(
  userId: string, weekId: string, jobId: string, rows: GradeRow[], versions: Record<string, string>, statements: Statement[],
) {
  return withTeacherTransaction(userId, async context => {
    const { tx, teacherId } = context
    const { rows: [job] } = await tx.execute(sql`
      select closed_at from public.exam_photo_job where id=${jobId}::uuid
        and week_id=${weekId}::uuid and teacher_id=${teacherId}::uuid for update
    `)
    if (!job) throw new SaveError('채점 작업에 접근할 수 없습니다.', 403)
    const studentIds = rows.map(row => row.student_id)
    const { rows: items } = await tx.execute(sql`
      select student_id, photo_path, grade_draft, finalized_grade_version
      from public.exam_photo_job_item where job_id=${jobId}::uuid
        and student_id in (${sql.join(studentIds.map(id => sql`${id}::uuid`), sql`, `)})
      order by student_id for update
    `)
    const byStudent = new Map(items.map(item => [item.student_id, item]))
    for (const row of rows) {
      const item = byStudent.get(row.student_id)
      if (!row.present || !row.reading_present || !item?.grade_draft ||
          item.photo_path !== row.exam_photo_path || item.photo_path !== `${weekId}/${row.student_id}/${jobId}`) {
        throw new SaveError('채점 작업의 답안과 사진을 확인해 주세요.', 422)
      }
    }
    const receipts = items.flatMap(item => item.finalized_grade_version ? [item.finalized_grade_version as SavedGradeVersion] : [])
    if (receipts.length === rows.length) return { ok: true as const, versions: receipts, replayed: true }
    if (job.closed_at || receipts.length) throw new SaveError('이미 확정된 답안이 포함되어 있습니다. 작업을 다시 열어 주세요.', 409)

    for (const row of rows) {
      const draft = byStudent.get(row.student_id)?.grade_draft as GradeRow
      if (!isDeepStrictEqual(draft.answers, row.answers) || draft.answers.some(answer => answer.needs_review)) {
        throw new SaveError('저장된 검토 내용이 변경됐습니다. 작업을 다시 열어 주세요.', 409)
      }
    }
    const saved = await applyGradePlan(context, weekId, versions, statements, studentIds)
    const updated = await tx.execute(sql`
      update public.exam_photo_job_item i set finalized_grade_version=receipt
      from jsonb_array_elements(${JSON.stringify(saved.versions)}::jsonb) receipt
      where i.job_id=${jobId}::uuid and i.student_id=(receipt->>'student_id')::uuid returning i.student_id
    `)
    if (updated.rows.length !== rows.length) throw new SaveError('성적 확정 결과를 기록하지 못했습니다.', 503)
    await tx.execute(sql`
      update public.exam_photo_job j set closed_at=now()
      where j.id=${jobId}::uuid and not exists (
        select 1 from public.exam_photo_job_item i where i.job_id=j.id and i.finalized_grade_version is null
      )
    `)
    return { ...saved, replayed: false }
  })
}
