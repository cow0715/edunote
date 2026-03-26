import { getAuth, err, ok } from '@/lib/api'
import { gradeSubjectiveAnswers, SubjectiveStudentAnswer } from '@/lib/anthropic'
import { recalcReadingCorrect } from '@/lib/grade-utils'

// 과제/메모 단순 저장 (AI 채점 없음)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

  const { student_id, homework_done, memo } = await request.json()
  if (!student_id) return err('student_id 필요')

  await supabase
    .from('week_score')
    .upsert(
      { week_id: weekId, student_id, homework_done: homework_done ?? null, memo: memo || null },
      { onConflict: 'week_id,student_id' }
    )

  return ok({ ok: true })
}

// 채점 현황 조회
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

  const { data: week } = await supabase
    .from('week')
    .select('class_id, start_date')
    .eq('id', weekId)
    .single()

  if (!week) return err('주차 없음', 404)

  const [{ data: classStudents }, { data: weekScores }, { data: questions }, { data: vocabWords }] = await Promise.all([
    supabase.from('class_student').select('student_id, student(*)').eq('class_id', week.class_id).order('created_at'),
    supabase.from('week_score').select('*, student_answer(*), student_vocab_answer(*, vocab_word(*))').eq('week_id', weekId),
    supabase.from('exam_question').select('*, exam_question_tag(concept_tag(*, concept_category(*)))').eq('week_id', weekId).eq('exam_type', 'reading').order('question_number').order('sub_label', { nullsFirst: true }),
    supabase.from('vocab_word').select('id, number, english_word').eq('week_id', weekId).order('number'),
  ])

  let attendance: { student_id: string; status: string }[] = []
  if (week.start_date) {
    const { data: att } = await supabase
      .from('attendance')
      .select('student_id, status')
      .eq('class_id', week.class_id)
      .eq('date', week.start_date)
    attendance = att ?? []
  }

  return ok({ classStudents, weekScores, questions, attendance, vocabWords })
}

// 일괄 저장 + 서술형 AI 배치 채점
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await handlePost(request, params)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[POST /api/weeks/[id]/grade] unhandled error', e)
    return err(msg, 500)
  }
}

async function handlePost(request: Request, params: Promise<{ id: string }>) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

  type GradeRow = {
    student_id: string
    student_name: string
    present: boolean
    vocab_correct: number | null
    reading_present: boolean
    reading_correct: number | null
    homework_done: number | null
    memo: string
    answers: {
      exam_question_id: string
      student_answer: number | null
      student_answer_text?: string
      ox_selection?: string | null
      is_correct?: boolean
      teacher_confirmed?: boolean
    }[]
  }

  let rows: GradeRow[]
  try {
    rows = await request.json()
  } catch {
    return err('요청 데이터 파싱 실패')
  }

  // 이 주차의 모든 문항 정보 한 번에 조회 (style, correct_answer, 모범답안)
  const { data: allQuestions } = await supabase
    .from('exam_question')
    .select('id, question_number, sub_label, correct_answer, correct_answer_text, grading_criteria, question_style')
    .eq('week_id', weekId)

  const questionMap = new Map(allQuestions?.map((q) => [q.id, q]) ?? [])

  // oxSelection: 'O' | 'X' | null, correctionText: 수정어만 (X 접두사 없음)
  function gradeOX(correctAnswerText: string, oxSelection: string | null, correctionText: string): boolean {
    const correct = correctAnswerText.trim()
    if (/^O$/i.test(correct)) return oxSelection === 'O'
    if (oxSelection !== 'X') return false
    let correction = correct.match(/\((.+)\)/)?.[1]?.trim().toLowerCase() ?? ''
    if (correction.includes('→')) correction = correction.split('→').pop()?.trim() ?? correction
    const student = correctionText.trim().toLowerCase()
    // '/' 구분자로 복수 정답 허용 (예: "in which / where")
    const alternatives = correction.split('/').map((s) => s.trim()).filter(Boolean)
    return alternatives.some((alt) => student === alt)
  }

  function gradeMultiSelect(correctAnswerText: string, studentAnswerText: string): boolean {
    const normalize = (t: string) => t.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).sort().join(',')
    return normalize(correctAnswerText) === normalize(studentAnswerText)
  }

  // "기호:수정어" 형식 여부 (찾아 고치시오 유형)
  function isSymbolCorrection(text: string | null): boolean {
    return !!text && /^[a-z]:.+$/i.test(text.trim())
  }

  // 학생 답안에서 수정어만 추출 ("e: watching", "watched → watching", "watching" 모두 → "watching")
  function extractCorrection(text: string): string {
    let s = text.trim()
    s = s.replace(/^[a-z]\s*:\s*/i, '')          // "e: watching" → "watching"
    s = s.replace(/^\([a-z]\)\s*:?\s*/i, '')      // "(e): watching" → "watching"
    if (s.includes('→')) s = s.split('→').pop()!   // "watched → watching" → "watching"
    return s.trim().toLowerCase()
  }

  // 서술형 배치 채점용 수집
  const subjectiveForGrading: SubjectiveStudentAnswer[] = []

  // 기호:수정어 유형 — 코드 레벨 집합 채점용 수집 (빈칸 포함)
  type SymbolCorrEntry = {
    week_score_id: string
    exam_question_id: string
    question_number: number
    student_answer_text: string
    correct_answer_text: string
  }
  const symbolCorrForGrading: SymbolCorrEntry[] = []
  const processedScoreIds: string[] = []

  for (const row of rows) {
    if (!row.present) {
      await supabase
        .from('week_score')
        .delete()
        .eq('week_id', weekId)
        .eq('student_id', row.student_id)
      continue
    }

    // reading_present=false이면 reading_correct를 null로 강제
    const readingCorrectForUpsert = row.reading_present === false ? null : row.reading_correct

    const { data: score, error: scoreError } = await supabase
      .from('week_score')
      .upsert(
        { week_id: weekId, student_id: row.student_id, vocab_correct: row.vocab_correct, reading_correct: readingCorrectForUpsert, homework_done: row.homework_done, memo: row.memo || null },
        { onConflict: 'week_id,student_id' }
      )
      .select()
      .single()

    if (scoreError) {
      console.error('[POST /api/weeks/[id]/grade] week_score upsert', scoreError)
      return err(scoreError.message, 500)
    }

    // reading_present=false이면 answers 처리 스킵 + reading_correct=null 이미 upsert됨
    if (row.reading_present === false) continue

    processedScoreIds.push(score.id)

    if (row.answers.length > 0) {
      const answersToUpsert = row.answers.map((a) => {
        const q = questionMap.get(a.exam_question_id)
        const style = q?.question_style ?? 'objective'

        // 선생님이 확정한 답안 → AI 재채점 없이 그대로 보존
        if (a.teacher_confirmed) {
          const isTextAnswer = style === 'subjective' || style === 'multi_select' || style === 'find_error'
          return {
            week_score_id: score.id,
            exam_question_id: a.exam_question_id,
            student_answer: isTextAnswer ? null : a.student_answer,
            student_answer_text: isTextAnswer ? (a.student_answer_text ?? null) : null,
            ox_selection: style === 'ox' ? (a.ox_selection ?? null) : null,
            is_correct: a.is_correct ?? false,
            needs_review: false,
            teacher_confirmed: true,
          }
        }

        if (style === 'ox') {
          // UI 포맷("O", "X 수정어") → ox_selection + student_answer_text(수정어만) 분리
          const raw = (a.student_answer_text ?? '').trim()
          const upper = raw.toUpperCase()
          const oxSelection = upper === 'O' ? 'O' : raw !== '' ? 'X' : null
          const correction = upper.startsWith('X ') ? raw.slice(2).trim() || null
            : (upper === 'O' || upper === 'X' || raw === '') ? null
            : raw || null  // 구형 포맷(수정어만 저장된 경우) 그대로
          const is_correct = q?.correct_answer_text ? gradeOX(q.correct_answer_text, oxSelection, correction ?? '') : false
          return {
            week_score_id: score.id,
            exam_question_id: a.exam_question_id,
            student_answer: null,
            student_answer_text: correction,
            ox_selection: oxSelection,
            is_correct,
          }
        }

        const isTextAnswer = style === 'subjective' || style === 'multi_select' || style === 'find_error'
        const is_correct = style === 'objective'
          ? (a.student_answer !== null && a.student_answer === q?.correct_answer)
          : style === 'multi_select'
            ? (q?.correct_answer_text ? gradeMultiSelect(q.correct_answer_text, a.student_answer_text ?? '') : false)
            : false // subjective: AI 채점 후 업데이트
        return {
          week_score_id: score.id,
          exam_question_id: a.exam_question_id,
          student_answer: isTextAnswer ? null : a.student_answer,
          student_answer_text: isTextAnswer ? (a.student_answer_text ?? null) : null,
          ox_selection: null,
          is_correct,
        }
      })

      const { error: answerError } = await supabase
        .from('student_answer')
        .upsert(answersToUpsert, { onConflict: 'week_score_id,exam_question_id' })

      if (answerError) {
        console.error('[POST /api/weeks/[id]/grade] student_answer upsert', answerError)
        return err(answerError.message, 500)
      }

      // subjective/find_error 채점용 수집 — 기호:수정어 유형은 코드 레벨, 나머지는 AI
      for (const a of row.answers) {
        if (a.teacher_confirmed) continue  // 선생님 확정 답안은 재채점 스킵
        const q = questionMap.get(a.exam_question_id)
        if (q?.question_style !== 'subjective' && q?.question_style !== 'find_error') continue

        if (q.question_style === 'find_error' || isSymbolCorrection(q.correct_answer_text)) {
          // 빈칸 포함해서 수집 (집합 매칭에 필요)
          symbolCorrForGrading.push({
            week_score_id: score.id,
            exam_question_id: a.exam_question_id,
            question_number: q.question_number,
            student_answer_text: (a.student_answer_text ?? '').trim(),
            correct_answer_text: q.correct_answer_text!,
          })
        } else if ((a.student_answer_text ?? '').trim()) {
          subjectiveForGrading.push({
            week_score_id: score.id,
            exam_question_id: a.exam_question_id,
            question_number: q.question_number,
            sub_label: q.sub_label ?? null,
            student_name: row.student_name,
            student_answer_text: a.student_answer_text?.trim() ?? '',
          })
        }
      }
    }
  }

  // 기호:수정어 유형 — 코드 레벨 집합 채점 (순서 무관)
  if (symbolCorrForGrading.length > 0) {
    // (week_score_id, question_number) 기준으로 그룹핑
    const scGroups = new Map<string, SymbolCorrEntry[]>()
    for (const a of symbolCorrForGrading) {
      const key = `${a.week_score_id}__${a.question_number}`
      scGroups.set(key, [...(scGroups.get(key) ?? []), a])
    }

    for (const group of scGroups.values()) {
      const correctWords = group.map((a) => extractCorrection(a.correct_answer_text))
      const studentWords = group.map((a) => extractCorrection(a.student_answer_text))

      // 탐욕 집합 매칭
      const remaining = [...correctWords]
      const matched = group.map(() => false)
      for (let i = 0; i < group.length; i++) {
        if (!studentWords[i]) continue
        const idx = remaining.indexOf(studentWords[i])
        if (idx !== -1) {
          matched[i] = true
          remaining.splice(idx, 1)
        }
      }

      await Promise.all(group.map((a, i) =>
        supabase.from('student_answer')
          .update({
            is_correct: matched[i],
            needs_review: false,
            ai_feedback: matched[i] ? '' : `정답: ${correctWords[i]}`,
          })
          .eq('week_score_id', a.week_score_id)
          .eq('exam_question_id', a.exam_question_id)
      ))
    }
  }

  // 서술형 AI 배치 채점
  if (subjectiveForGrading.length > 0) {
    const uniqueKeys = [...new Set(subjectiveForGrading.map((a) => `${a.question_number}__${a.sub_label ?? ''}`))]
    const subjectiveQuestions = uniqueKeys
      .map((key) => {
        const [qNumStr, subLabel] = key.split('__')
        const qNum = Number(qNumStr)
        const sub = subLabel || null
        const q = allQuestions?.find((q) => q.question_number === qNum && q.sub_label === sub && q.question_style === 'subjective')
        return q ? {
          question_number: q.question_number,
          sub_label: q.sub_label ?? null,
          correct_answer_text: q.correct_answer_text ?? '',
          grading_criteria: q.grading_criteria,
        } : null
      })
      .filter((q): q is NonNullable<typeof q> => q !== null && q.correct_answer_text !== '')

    if (subjectiveQuestions.length > 0) {
      try {
        const gradingResults = await gradeSubjectiveAnswers(subjectiveQuestions, subjectiveForGrading)

        for (const result of gradingResults) {
          await supabase
            .from('student_answer')
            .update({ is_correct: result.is_correct, needs_review: result.needs_review, ai_feedback: result.ai_feedback })
            .eq('week_score_id', result.week_score_id)
            .eq('exam_question_id', result.exam_question_id)
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e)
        console.error('[POST /api/weeks/[id]/grade] AI grading failed', e)
        // AI 실패해도 저장은 성공으로 처리 (reading_correct는 객관식만 반영됨)
        await recalcReadingCorrect(supabase, processedScoreIds)
        return ok({ ok: true, ai_grading_failed: true, ai_error: errMsg })
      }
    }
  }

  // student_answer.is_correct 기준으로 reading_correct 자동 계산 (답안 없으면 null)
  await recalcReadingCorrect(supabase, processedScoreIds)

  return ok({ ok: true })
}
