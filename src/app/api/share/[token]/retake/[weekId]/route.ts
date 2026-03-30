import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { gradeVocabItems } from '@/lib/anthropic'

type Params = { token: string; weekId: string }

// ── GET: 오답 단어 목록 + 재시험 여부 조회 ────────────────────────────────
export async function GET(_: Request, { params }: { params: Promise<Params> }) {
  const supabase = createServiceClient()
  const { token, weekId } = await params

  const { data: student } = await supabase
    .from('student')
    .select('id, name')
    .eq('share_token', token)
    .single()
  if (!student) return NextResponse.json({ error: '학생을 찾을 수 없습니다' }, { status: 404 })

  const { data: score } = await supabase
    .from('week_score')
    .select('id, vocab_retake_correct')
    .eq('week_id', weekId)
    .eq('student_id', student.id)
    .single()
  if (!score) return NextResponse.json({ error: '성적 데이터가 없습니다' }, { status: 404 })

  const { data: week } = await supabase
    .from('week')
    .select('week_number, vocab_total, class_id')
    .eq('id', weekId)
    .single()
  if (!week) return NextResponse.json({ error: '주차 정보가 없습니다' }, { status: 404 })

  const { data: classRow } = await supabase
    .from('class')
    .select('name')
    .eq('id', week.class_id)
    .single()

  // 틀린 단어 조회 (retake 결과 포함)
  const { data: wrongAnswers } = await supabase
    .from('student_vocab_answer')
    .select('id, retake_answer, retake_is_correct, vocab_word(id, number, english_word, correct_answer, synonyms, antonyms)')
    .eq('week_score_id', score.id)
    .eq('is_correct', false)
    .order('id')

  const words = (wrongAnswers ?? [])
    .filter((a) => a.vocab_word)
    .map((a) => {
      const vw = Array.isArray(a.vocab_word) ? a.vocab_word[0] : a.vocab_word
      return {
        answer_id: a.id,
        number: vw.number,
        english_word: vw.english_word,
        correct_answer: vw.correct_answer,
        synonyms: vw.synonyms ?? null,
        antonyms: vw.antonyms ?? null,
        retake_answer: a.retake_answer ?? null,
        retake_is_correct: a.retake_is_correct ?? null,
      }
    })
    .sort((a, b) => a.number - b.number)

  const already_retaken = score.vocab_retake_correct !== null

  return NextResponse.json({
    student: { name: student.name },
    week: { week_number: week.week_number, class_name: classRow?.name ?? '', vocab_total: week.vocab_total },
    score_id: score.id,
    vocab_retake_correct: score.vocab_retake_correct,
    words,
    already_retaken,
  })
}

// ── POST: 재시험 답안 제출 → AI 채점 → 저장 ──────────────────────────────
export async function POST(request: Request, { params }: { params: Promise<Params> }) {
  const supabase = createServiceClient()
  const { token, weekId } = await params

  const { data: student } = await supabase
    .from('student')
    .select('id')
    .eq('share_token', token)
    .single()
  if (!student) return NextResponse.json({ error: '학생을 찾을 수 없습니다' }, { status: 404 })

  const { data: score } = await supabase
    .from('week_score')
    .select('id, vocab_retake_correct')
    .eq('week_id', weekId)
    .eq('student_id', student.id)
    .single()
  if (!score) return NextResponse.json({ error: '성적 데이터가 없습니다' }, { status: 404 })

  // 이미 재시험 완료
  if (score.vocab_retake_correct !== null) {
    return NextResponse.json({ error: '이미 재시험을 완료했습니다' }, { status: 409 })
  }

  const { answers } = await request.json() as {
    answers: { answer_id: string; english_word: string; retake_answer: string }[]
  }
  if (!answers?.length) return NextResponse.json({ error: '답안 없음' }, { status: 400 })

  // vocab grading rules
  const { data: promptRow } = await supabase
    .from('prompts')
    .select('content')
    .eq('key', 'vocab_grading_rules')
    .maybeSingle()
  const customRules = promptRow?.content ?? undefined

  // AI 채점
  const gradingItems = answers.map((a) => ({
    number: 0, // gradeVocabItems는 number를 결과 매핑에만 사용
    english_word: a.english_word,
    student_answer: a.retake_answer || null,
  }))

  let graded: { number: number; english_word: string; student_answer: string | null; is_correct: boolean }[]
  try {
    graded = await gradeVocabItems(gradingItems, customRules)
  } catch (e) {
    console.error('[retake] AI 채점 실패', e)
    return NextResponse.json({ error: '채점 중 오류가 발생했습니다' }, { status: 500 })
  }

  // answer_id 기준으로 채점 결과 매핑 (english_word 기준)
  const resultMap = new Map(graded.map((g, i) => [answers[i].answer_id, g.is_correct]))

  // student_vocab_answer 업데이트
  await Promise.all(
    answers.map((a) => {
      const is_correct = resultMap.get(a.answer_id) ?? false
      return supabase
        .from('student_vocab_answer')
        .update({ retake_answer: a.retake_answer || null, retake_is_correct: is_correct })
        .eq('id', a.answer_id)
    })
  )

  // vocab_retake_correct 계산 후 week_score 업데이트
  const retakeCorrect = [...resultMap.values()].filter(Boolean).length
  await supabase
    .from('week_score')
    .update({ vocab_retake_correct: retakeCorrect })
    .eq('id', score.id)

  // 결과 반환
  const results = answers.map((a) => ({
    answer_id: a.answer_id,
    english_word: a.english_word,
    retake_answer: a.retake_answer,
    is_correct: resultMap.get(a.answer_id) ?? false,
  }))

  return NextResponse.json({ ok: true, retake_correct: retakeCorrect, total: answers.length, results })
}
