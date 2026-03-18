import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export async function POST(request: Request) {
  const supabase = await createClient()

  // cron 요청은 CRON_SECRET 헤더로 인증, 관리자 요청은 세션으로 인증
  const authHeader = request.headers.get('authorization')
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (!isCron) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })
  }

  // ── 1. 데이터 조회 ──────────────────────────────────────────────────────
  const { data: classes } = await supabase
    .from('class')
    .select('id, name')

  const { data: weeks } = await supabase
    .from('week')
    .select('id, class_id, week_number, start_date, vocab_total, reading_total, homework_total')
    .order('week_number')

  const { data: students } = await supabase
    .from('student')
    .select('id, name, school, grade')

  const { data: weekScores } = await supabase
    .from('week_score')
    .select('id, week_id, student_id, vocab_correct, reading_correct, homework_done, memo')

  const { data: studentAnswers } = await supabase
    .from('student_answer')
    .select(`
      week_score_id, is_correct, student_answer, student_answer_text, ai_feedback,
      exam_question(question_number, sub_label, question_style, correct_answer, correct_answer_text)
    `)

  // ── 2. 룩업 맵 ──────────────────────────────────────────────────────────
  const classMap = new Map((classes ?? []).map((c) => [c.id, c.name]))
  const weekMap = new Map((weeks ?? []).map((w) => [w.id, w]))
  const studentMap = new Map((students ?? []).map((s) => [s.id, s.name]))
  const scoreMap = new Map((weekScores ?? []).map((s) => [s.id, s]))

  // ── 3. Sheet 1: 주차별 점수 ─────────────────────────────────────────────
  const scoreSheet = (weekScores ?? []).map((s) => {
    const w = weekMap.get(s.week_id)
    return {
      수업: classMap.get(w?.class_id ?? '') ?? '',
      주차: w?.week_number ?? '',
      수업일: w?.start_date ?? '',
      학생: studentMap.get(s.student_id) ?? '',
      단어_맞은수: s.vocab_correct,
      단어_총수: w?.vocab_total ?? 0,
      단어_정답률: w?.vocab_total ? `${Math.round((s.vocab_correct / w.vocab_total) * 100)}%` : '',
      진단_맞은수: s.reading_correct,
      진단_총수: w?.reading_total ?? 0,
      진단_정답률: w?.reading_total ? `${Math.round((s.reading_correct / w.reading_total) * 100)}%` : '',
      숙제_완료: s.homework_done,
      숙제_총수: w?.homework_total ?? 0,
      메모: s.memo ?? '',
    }
  })

  // ── 4. Sheet 2: 문항별 답안 ─────────────────────────────────────────────
  const answerSheet = (studentAnswers ?? []).map((a) => {
    const score = scoreMap.get(a.week_score_id)
    const w = score ? weekMap.get(score.week_id) : null
    const q = a.exam_question as {
      question_number: number; sub_label: string | null
      question_style: string; correct_answer: number | null; correct_answer_text: string | null
    } | null
    return {
      수업: classMap.get(w?.class_id ?? '') ?? '',
      주차: w?.week_number ?? '',
      수업일: w?.start_date ?? '',
      학생: score ? (studentMap.get(score.student_id) ?? '') : '',
      문항번호: q ? `${q.question_number}${q.sub_label ? `(${q.sub_label})` : ''}` : '',
      문항형식: q?.question_style ?? '',
      학생답안: a.student_answer_text ?? (a.student_answer != null ? String(a.student_answer) : ''),
      정답: q?.correct_answer_text ?? (q?.correct_answer != null ? String(q.correct_answer) : ''),
      정오: a.is_correct ? 'O' : 'X',
      AI피드백: a.ai_feedback ?? '',
    }
  })

  // ── 5. Excel 생성 ────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(scoreSheet), '주차별 점수')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(answerSheet), '문항별 답안')

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  // ── 6. Supabase Storage 저장 ─────────────────────────────────────────────
  const dateStr = new Date().toISOString().slice(0, 10)
  const fileName = `backup_${dateStr}.xlsx`

  const { error: uploadErr } = await supabase.storage
    .from('backup')
    .upload(fileName, buffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: true,
    })

  if (uploadErr) {
    console.error('[backup] Storage 저장 실패:', uploadErr)
    return NextResponse.json({ error: uploadErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, file: fileName })
}

// 관리자가 특정 백업 파일 즉시 다운로드
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const file = searchParams.get('file')

  if (!file) {
    // 파일 목록 반환
    const { data: files } = await supabase.storage.from('backup').list('', { sortBy: { column: 'name', order: 'desc' } })
    return NextResponse.json({ files: files ?? [] })
  }

  // signed URL 발급 (1시간)
  const { data, error } = await supabase.storage.from('backup').createSignedUrl(file, 3600)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ url: data.signedUrl })
}
