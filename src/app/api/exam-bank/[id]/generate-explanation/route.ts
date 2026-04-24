import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import { generateExplanations, QuestionForExplanation } from '@/lib/anthropic'

export const maxDuration = 300

// 평가원/수능: PDF에 풀이가 있으므로 일부 문항만 AI 보완
const PYUNGWON_RANGES = [[20, 24], [29, 42]] as const

// 학평: 듣기(1~17) 제외한 독해 전체
const HAKPYUNG_MONTHS = [3, 4, 5, 7, 10]

function isHakpyung(month: number): boolean {
  return HAKPYUNG_MONTHS.includes(month)
}

function isPyungwonTarget(n: number): boolean {
  return PYUNGWON_RANGES.some(([from, to]) => n >= from && n <= to)
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { id } = await params

  // 소유권 + 시험 월 확인
  const { data: exam } = await supabase
    .from('exam_bank')
    .select('id, exam_month')
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .single()

  if (!exam) return err('시험을 찾을 수 없습니다', 404)

  const hakpyung = isHakpyung(exam.exam_month)

  // 문항 조회
  const serviceClient = createServiceClient()
  const { data: rows, error: fetchErr } = await serviceClient
    .from('exam_bank_question')
    .select('id, question_number, passage, question_text, choices, answer')
    .eq('exam_bank_id', id)
    .order('question_number')

  if (fetchErr || !rows) {
    return err(`문항 조회 실패: ${fetchErr?.message}`)
  }

  const targets: QuestionForExplanation[] = rows
    .filter((r) => hakpyung ? r.question_number >= 18 : isPyungwonTarget(r.question_number))
    .map((r) => ({
      question_number: r.question_number,
      passage: r.passage ?? '',
      question_text: r.question_text ?? '',
      choices: Array.isArray(r.choices) ? r.choices.map(String) : [],
      answer: r.answer ?? '',
    }))

  if (targets.length === 0) {
    return err('AI 생성 대상 문항이 없습니다', 422)
  }

  let generated
  try {
    generated = await generateExplanations(targets, 'full')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return err(`AI 해설 생성 실패: ${msg}`, 500)
  }

  let updated = 0
  for (const g of generated) {
    // 학평: PDF에서 이미 가져온 출제의도/해석은 덮어쓰지 않음
    const updateFields = hakpyung
      ? { explanation_solution: g.solution || null, explanation_vocabulary: g.vocabulary || null }
      : { explanation_intent: g.intent || null, explanation_translation: g.translation || null, explanation_solution: g.solution || null, explanation_vocabulary: g.vocabulary || null }

    const { error } = await serviceClient
      .from('exam_bank_question')
      .update(updateFields)
      .eq('exam_bank_id', id)
      .eq('question_number', g.question_number)

    if (!error) updated++
  }

  return ok({ updated, total: targets.length, mode: hakpyung ? 'hakpyung' : 'standard' })
}
