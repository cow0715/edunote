import { getAuth, err, ok } from '@/lib/api'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  // cron 또는 인증된 사용자 허용
  const authHeader = request.headers.get('authorization')
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`
  if (!isCron) {
    const supabaseUser = await createClient()
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) return err('인증 필요', 401)
  }

  // RLS 우회를 위해 service role 클라이언트 사용
  const supabase = createServiceClient()

  // ── 전체 테이블 덤프 (FK 순서대로) ──────────────────────────────────────
  const [
    { data: teacher },
    { data: concept_category },
    { data: concept_tag },
    { data: cls },
    { data: student },
    { data: class_student },
    { data: week },
    { data: exam_question },
    { data: exam_question_tag },
    { data: week_score },
    { data: student_answer },
    { data: attendance },
    { data: teacher_memos },
  ] = await Promise.all([
    supabase.from('teacher').select('*'),
    supabase.from('concept_category').select('*'),
    supabase.from('concept_tag').select('*'),
    supabase.from('class').select('*'),
    supabase.from('student').select('*'),
    supabase.from('class_student').select('*'),
    supabase.from('week').select('*'),
    supabase.from('exam_question').select('*'),
    supabase.from('exam_question_tag').select('*'),
    supabase.from('week_score').select('*'),
    supabase.from('student_answer').select('*'),
    supabase.from('attendance').select('*'),
    supabase.from('teacher_memos').select('*'),
  ])

  const dump = {
    version: 1,
    created_at: new Date().toISOString(),
    tables: {
      teacher:            teacher            ?? [],
      concept_category:   concept_category   ?? [],
      concept_tag:        concept_tag        ?? [],
      class:              cls                ?? [],
      student:            student            ?? [],
      class_student:      class_student      ?? [],
      week:               week               ?? [],
      exam_question:      exam_question      ?? [],
      exam_question_tag:  exam_question_tag  ?? [],
      week_score:         week_score         ?? [],
      student_answer:     student_answer     ?? [],
      attendance:         attendance         ?? [],
      teacher_memos:      teacher_memos      ?? [],
    },
  }

  const buffer = Buffer.from(JSON.stringify(dump, null, 2), 'utf-8')
  const dateStr = new Date().toISOString().slice(0, 10)
  const timeStr = new Date().toISOString().slice(11, 16).replace(':', '')
  const fileName = `backup_${dateStr}_${timeStr}.json`

  const { error: uploadErr } = await supabase.storage
    .from('backup')
    .upload(fileName, buffer, {
      contentType: 'application/json',
      upsert: true,
    })

  if (uploadErr) {
    console.error('[backup] Storage 저장 실패:', uploadErr)
    return err(uploadErr.message, 500)
  }

  const rowCounts = Object.fromEntries(
    Object.entries(dump.tables).map(([k, v]) => [k, v.length])
  )
  console.log('[backup] 완료:', fileName, rowCounts)
  return ok({ ok: true, file: fileName, rows: rowCounts })
}

// 백업 파일 목록 조회 or signed URL 발급
export async function GET(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { searchParams } = new URL(request.url)
  const file = searchParams.get('file')

  if (!file) {
    const { data: files } = await supabase.storage
      .from('backup')
      .list('', { sortBy: { column: 'name', order: 'desc' }, limit: 30 })
    return ok({ files: files ?? [] })
  }

  const { data, error } = await supabase.storage.from('backup').createSignedUrl(file, 3600)
  if (error) return err(error.message, 500)
  return ok({ url: data.signedUrl })
}
