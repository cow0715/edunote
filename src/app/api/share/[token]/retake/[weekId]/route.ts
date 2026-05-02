import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { gradeVocabItems } from '@/lib/anthropic'
import { buildWeekDisplayMap, type ClassPeriod } from '@/lib/class-periods'

type Params = { token: string; weekId: string }

type VocabWordRow = {
  number: number
  english_word: string
  correct_answer: string
  synonyms: string | null
  antonyms: string | null
  example_sentence: string | null
  example_translation: string | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

// ── GET: 아직 못 맞힌 단어만 반환 ────────────────────────────────────────────
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
    .select('id, week_number, start_date, vocab_total, class_id')
    .eq('id', weekId)
    .single()
  if (!week) return NextResponse.json({ error: '주차 정보가 없습니다' }, { status: 404 })

  const { data: classRow } = await supabase
    .from('class')
    .select('name')
    .eq('id', week.class_id)
    .single()

  const [{ data: periods }, { data: classWeeks }] = await Promise.all([
    supabase.from('class_period').select('*').eq('class_id', week.class_id).order('sort_order').order('start_date'),
    supabase.from('week').select('id, class_id, week_number, start_date').eq('class_id', week.class_id),
  ])
  const weekLabel = buildWeekDisplayMap(classWeeks ?? [], (periods ?? []) as ClassPeriod[]).get(week.id)?.displayLabel ?? `${week.week_number}주차`

  // 원본 오답 전체 조회
  const { data: wrongAnswers } = await supabase
    .from('student_vocab_answer')
    .select('id, retake_answer, retake_is_correct, vocab_word(id, number, english_word, correct_answer, synonyms, antonyms, example_sentence, example_translation)')
    .eq('week_score_id', score.id)
    .eq('is_correct', false)
    .order('id')

  const allWrong = (wrongAnswers ?? [])
    .filter((a) => a.vocab_word)
    .map((a) => {
      const vw = one(a.vocab_word) as VocabWordRow
      return {
        answer_id: a.id,
        number: vw.number,
        english_word: vw.english_word,
        correct_answer: vw.correct_answer,
        synonyms: vw.synonyms ?? null,
        antonyms: vw.antonyms ?? null,
        example_sentence: vw.example_sentence ?? null,
        example_translation: vw.example_translation ?? null,
        retake_answer: a.retake_answer ?? null,
        retake_is_correct: a.retake_is_correct ?? null,
      }
    })
    .sort((a, b) => a.number - b.number)

  // 아직 못 맞힌 단어만 출제 (null = 미응시, false = 틀림)
  const words = allWrong.filter((w) => w.retake_is_correct !== true)
  const completed = words.length === 0

  return NextResponse.json({
    student: { name: student.name },
    week: { week_number: week.week_number, display_label: weekLabel, class_name: classRow?.name ?? '', vocab_total: week.vocab_total },
    score_id: score.id,
    vocab_retake_correct: score.vocab_retake_correct,
    words,
    completed,
  })
}

// ── POST: 재시험 답안 제출 → AI 채점 → 저장 (무제한 반복 가능) ────────────────
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
    .select('id')
    .eq('week_id', weekId)
    .eq('student_id', student.id)
    .single()
  if (!score) return NextResponse.json({ error: '성적 데이터가 없습니다' }, { status: 404 })

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
    number: 0,
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

  const resultMap = new Map(graded.map((g, i) => [answers[i].answer_id, g.is_correct]))

  // 채점 결과 저장 (이전 시도 덮어씌우기)
  await Promise.all(
    answers.map((a) => {
      const is_correct = resultMap.get(a.answer_id) ?? false
      return supabase
        .from('student_vocab_answer')
        .update({ retake_answer: a.retake_answer || null, retake_is_correct: is_correct })
        .eq('id', a.answer_id)
    })
  )

  // 전체 누적 통계 재계산
  const { data: allAnswersAfter } = await supabase
    .from('student_vocab_answer')
    .select('retake_is_correct')
    .eq('week_score_id', score.id)
    .eq('is_correct', false)

  const totalMastered = (allAnswersAfter ?? []).filter((a) => a.retake_is_correct === true).length
  const remaining = (allAnswersAfter ?? []).filter((a) => a.retake_is_correct !== true).length

  await supabase
    .from('week_score')
    .update({ vocab_retake_correct: totalMastered })
    .eq('id', score.id)

  const results = answers.map((a) => ({
    answer_id: a.answer_id,
    english_word: a.english_word,
    retake_answer: a.retake_answer,
    is_correct: resultMap.get(a.answer_id) ?? false,
  }))

  return NextResponse.json({
    ok: true,
    retake_correct: [...resultMap.values()].filter(Boolean).length,
    total: answers.length,
    results,
    remaining,
    total_mastered: totalMastered,
  })
}
