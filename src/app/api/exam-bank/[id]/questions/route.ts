import { getAuth, getTeacherId, err, ok } from '@/lib/api'

// GET — 특정 시험의 문항 조회
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { id } = await params

  // 소유권 확인
  const { data: exam } = await supabase
    .from('exam_bank')
    .select('id')
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .single()

  if (!exam) return err('시험을 찾을 수 없습니다', 404)

  const { data, error } = await supabase
    .from('exam_bank_question')
    .select('*')
    .eq('exam_bank_id', id)
    .order('question_number')

  if (error) return err(error.message)
  return ok(data)
}

// POST — 문항 단건 추가
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { id } = await params

  const { data: exam } = await supabase
    .from('exam_bank')
    .select('id')
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .single()

  if (!exam) return err('시험을 찾을 수 없습니다', 404)

  const { question_number, question_type, passage, question_text, choices, answer } = await request.json()

  if (!question_number || !question_type || !question_text) {
    return err('필수 정보 누락 (question_number, question_type, question_text)')
  }

  const { data, error } = await supabase
    .from('exam_bank_question')
    .insert({
      exam_bank_id: id,
      question_number,
      question_type,
      passage: passage || '',
      question_text,
      choices: choices || [],
      answer: answer || '',
      raw_text: '',
    })
    .select()
    .single()

  if (error) return err(error.message)
  return ok(data)
}
