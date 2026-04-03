import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { parseExamBankPage } from '@/lib/anthropic'

export const maxDuration = 300

// GET — 기출 시험 목록 조회
export async function GET() {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { data, error } = await supabase
    .from('exam_bank')
    .select('*, exam_bank_question(count)')
    .eq('teacher_id', teacherId)
    .order('exam_year', { ascending: false })
    .order('exam_month', { ascending: false })

  if (error) return err(error.message)
  return ok(data)
}

// POST — 기출 시험 생성 + PDF 파싱
export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { title, exam_year, exam_month, grade, source, fileData, mimeType } = await request.json()

  if (!title || !exam_year || !exam_month || !grade) {
    return err('필수 정보 누락 (title, exam_year, exam_month, grade)')
  }
  if (!fileData || !mimeType) {
    return err('PDF 파일 필요')
  }

  // 1. exam_bank 레코드 생성
  const { data: exam, error: examError } = await supabase
    .from('exam_bank')
    .insert({ teacher_id: teacherId, title, exam_year, exam_month, grade, source: source || '교육청' })
    .select()
    .single()

  if (examError) return err(examError.message)

  // 2. PDF 파싱 (Claude Vision)
  try {
    const questions = await parseExamBankPage(fileData, mimeType)

    if (questions.length === 0) {
      // 파싱 실패 시 exam_bank도 삭제
      await supabase.from('exam_bank').delete().eq('id', exam.id)
      return err('문항을 추출할 수 없습니다. PDF를 확인해주세요.', 422)
    }

    // 3. 문항 저장
    const rows = questions.map((q) => ({
      exam_bank_id: exam.id,
      question_number: q.question_number,
      question_type: q.question_type,
      passage: q.passage || '',
      question_text: q.question_text,
      choices: q.choices || [],
      answer: q.answer || '',
      raw_text: '',
    }))

    const { error: insertError } = await supabase
      .from('exam_bank_question')
      .insert(rows)

    if (insertError) {
      await supabase.from('exam_bank').delete().eq('id', exam.id)
      return err(`문항 저장 실패: ${insertError.message}`)
    }

    return ok({ ok: true, exam_id: exam.id, question_count: questions.length })
  } catch (e) {
    // 파싱 에러 시 exam_bank 삭제
    await supabase.from('exam_bank').delete().eq('id', exam.id)
    console.error('[exam-bank] 파싱 실패', e)
    return err('PDF 파싱 실패. 파일을 확인해주세요.', 422)
  }
}
