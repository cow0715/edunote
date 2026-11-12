import { assertWeekOwner, err, getAuth, getTeacherId, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/service'
import { EXAM_PHOTO_BUCKET } from '@/lib/photo-buckets'
import { isDeepStrictEqual } from 'node:util'

type Context = { params: Promise<{ id: string }> }

async function authorize(context: Context) {
  const { id: weekId } = await context.params
  const { user, supabase } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId || !await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)
  return { weekId, teacherId, db: createServiceClient() }
}

export async function GET(_request: Request, context: Context) {
  const auth = await authorize(context)
  if (auth instanceof Response) return auth
  const { db, weekId, teacherId } = auth
  const { data: job, error } = await db.from('exam_photo_job')
    .select('id, exam_photo_job_item(student_id, photo_path, mime_type, ocr_results, grade_draft, grade_draft_revision, finalized_grade_version)')
    .eq('week_id', weekId).eq('teacher_id', teacherId).is('closed_at', null).maybeSingle()
  if (error) return err('채점 작업을 불러오지 못했습니다.', 503)
  if (!job) return ok({ job: null })

  // The upload can finish just before the browser or function is interrupted.
  try {
    await Promise.all(job.exam_photo_job_item.filter((item) => !item.photo_path).map(async (item) => {
      const path = `${weekId}/${item.student_id}/${job.id}`
      const { data: photo } = await db.storage.from(EXAM_PHOTO_BUCKET).info(path)
      if (!((photo?.size ?? 0) > 0)) return
      const { error } = await db.from('exam_photo_job_item').update({ photo_path: path })
        .eq('job_id', job.id).eq('student_id', item.student_id).is('photo_path', null)
      if (error) throw error
      item.photo_path = path
    }))
  } catch {
    return err('이미 저장된 사진을 확인하지 못했습니다.', 503)
  }

  const { data: scores, error: scoreError } = await db.from('week_score')
    .select('student_id, exam_photo_path').eq('week_id', weekId)
  if (scoreError) return err('확정된 답안을 확인하지 못했습니다.', 503)
  const confirmed = new Map(scores.map((score) => [score.student_id, score.exam_photo_path]))
  const items = job.exam_photo_job_item.filter((item) =>
    !item.finalized_grade_version && (!item.photo_path || confirmed.get(item.student_id) !== item.photo_path))
  if (items.length) return ok({ job: { id: job.id, items } })

  const { error: closeError } = await db.from('exam_photo_job')
    .update({ closed_at: new Date().toISOString() }).eq('id', job.id).is('closed_at', null)
  return closeError ? err('채점 작업을 정리하지 못했습니다.', 503) : ok({ job: null })
}

export async function PATCH(request: Request, context: Context) {
  const auth = await authorize(context)
  if (auth instanceof Response) return auth
  const { db, weekId, teacherId } = auth
  const body = await request.json().catch(() => null)
  if (typeof body?.jobId !== 'string' || typeof body?.studentId !== 'string' ||
      !Number.isSafeInteger(body.revision) || body.revision < 1 || !Array.isArray(body.answers)) {
    return err('검토할 답안 정보를 확인해 주세요.')
  }

  const { data: item, error } = await db.from('exam_photo_job_item')
    .select('grade_draft, grade_draft_revision, exam_photo_job!inner(id)').eq('job_id', body.jobId).eq('student_id', body.studentId)
    .eq('exam_photo_job.week_id', weekId).eq('exam_photo_job.teacher_id', teacherId)
    .is('exam_photo_job.closed_at', null).maybeSingle()
  if (error) return err('채점 작업을 확인하지 못했습니다.', 503)
  if (!item?.grade_draft) return err('저장된 1차 채점 결과를 찾을 수 없습니다.', 404)

  const questionIds = new Set(item.grade_draft.answers.map((answer: { exam_question_id: string }) => answer.exam_question_id))
  if (body.answers.length !== questionIds.size || new Set(body.answers.map((answer: { exam_question_id: string }) => answer?.exam_question_id)).size !== questionIds.size ||
      body.answers.some((answer: { exam_question_id: string }) => !questionIds.has(answer?.exam_question_id))) {
    return err('검토 대상 문항이 변경됐습니다. 작업을 다시 열어 주세요.', 409)
  }
  const revision = body.revision + 1
  if (item.grade_draft_revision === revision && isDeepStrictEqual(item.grade_draft.answers, body.answers)) return ok({ revision })
  const { data: saved, error: saveError } = await db.from('exam_photo_job_item')
    .update({ grade_draft: { ...item.grade_draft, answers: body.answers }, grade_draft_revision: revision })
    .eq('job_id', body.jobId).eq('student_id', body.studentId).eq('grade_draft_revision', body.revision).is('finalized_grade_version', null)
    .select('student_id').maybeSingle()
  if (saveError) return err('검토 내용을 저장하지 못했습니다.', 503)
  if (!saved) return err('저장된 검토 내용이 바뀌었습니다. 작업을 다시 열어 주세요.', 409)
  return ok({ revision })
}

export async function POST(request: Request, context: Context) {
  const auth = await authorize(context)
  if (auth instanceof Response) return auth
  const { db, weekId, teacherId } = auth
  const body = await request.json().catch(() => null)
  if (typeof body?.closeJobId === 'string') {
    const { error } = await db.from('exam_photo_job').update({ closed_at: new Date().toISOString() })
      .eq('id', body.closeJobId).eq('week_id', weekId).eq('teacher_id', teacherId).is('closed_at', null)
    return error ? err('채점 작업을 종료하지 못했습니다.', 503) : ok({ ok: true })
  }
  const students: unknown = body?.studentIds
  if (!Array.isArray(students) || !students.length || students.some((id) => typeof id !== 'string') ||
      new Set(students).size !== students.length) return err('학생 연결을 확인해 주세요.')
  const { data: id, error } = await db.rpc('start_exam_photo_job', { p_week_id: weekId, p_teacher_id: teacherId, p_students: students })
  if (error?.code === '23505') return err('진행 중인 채점 작업을 먼저 이어서 처리해 주세요.', 409)
  if (error) return err('채점 작업을 시작하지 못했습니다. 학생 연결을 확인해 주세요.', 503)
  return ok({ id })
}
