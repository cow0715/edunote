import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { parseAnswerSheet, gradeSubjectiveAnswers, SubjectiveStudentAnswer, TagCategory } from '@/lib/anthropic'

export const maxDuration = 300

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)

  // 카테고리 + 태그 조회 (AI 프롬프트용 + 매칭용)
  const tagList: { id: string; name: string }[] = []
  const tagCategories: TagCategory[] = []

  if (teacherId) {
    const { data: categories } = await supabase
      .from('concept_category')
      .select('id, name')
      .eq('teacher_id', teacherId)
      .order('sort_order')

    const { data: tags } = await supabase
      .from('concept_tag')
      .select('id, name, concept_category_id')
      .eq('teacher_id', teacherId)
      .order('sort_order')

    for (const t of tags ?? []) tagList.push(t)

    for (const cat of categories ?? []) {
      const catTags = (tags ?? [])
        .filter((t) => t.concept_category_id === cat.id)
        .map((t) => t.name)
      if (catTags.length > 0) tagCategories.push({ categoryName: cat.name, tags: catTags })
    }
  }

  function matchTagId(questionType: string | null): string | null {
    if (!questionType) return null
    const exact = tagList.find((t) => t.name === questionType)
    if (exact) return exact.id
    const q = questionType.replace(/\s/g, '').toLowerCase()
    const norm = tagList.find((t) => t.name.replace(/\s/g, '').toLowerCase() === q)
    return norm?.id ?? null
  }

  const { fileData, mimeType, fileName } = await request.json()
  if (!fileData || !mimeType) return err('파일 없음')

  // ── 1. 해설지 파싱 ────────────────────────────────────────────────────
  let parsedAnswers
  try {
    parsedAnswers = await parseAnswerSheet(fileData, mimeType, tagCategories)
  } catch (e) {
    console.error('[parse-answers] 파싱 실패', e)
    return err('해설지 파싱 실패. 파일을 확인해주세요.', 422)
  }

  if (!parsedAnswers.length) {
    return err('문항을 찾을 수 없습니다', 422)
  }

  // ── 1-1. 후처리: sub_label 순서 정규화 (a,b,c,... 순서로 재부여) ────────
  // AI가 b,c,f 등 원본 기호를 그대로 쓰는 경우 a,b,c 순으로 정규화
  {
    const grouped = new Map<number, typeof parsedAnswers>()
    for (const a of parsedAnswers) {
      const arr = grouped.get(a.question_number) ?? []
      arr.push(a)
      grouped.set(a.question_number, arr)
    }

    const normalized: typeof parsedAnswers = []
    for (const [, group] of grouped) {
      if (group.length === 1) {
        normalized.push(...group)
      } else {
        // sub_label 기준 정렬 후 a,b,c,... 순서로 재부여
        const sorted = [...group].sort((x, y) => (x.sub_label ?? '').localeCompare(y.sub_label ?? ''))
        const alphabet = 'abcdefghijklmnopqrstuvwxyz'
        sorted.forEach((item, i) => {
          normalized.push({ ...item, sub_label: alphabet[i] })
        })
      }
    }
    parsedAnswers = normalized
  }

  // ── 2. 파일 Storage 저장 (실패해도 계속) ──────────────────────────────
  try {
    const safeName = (fileName as string | undefined)
      ?.replace(/[^\x00-\x7F]/g, '_')
      .replace(/[/\\?%*:|"<>\s]/g, '_')
      .replace(/_+/g, '_')
      ?? `${weekId}.bin`

    const fileBuffer = Buffer.from(fileData, 'base64')
    const { error: storageErr } = await supabase.storage
      .from('answer-sheets')
      .upload(safeName, fileBuffer, { contentType: mimeType, upsert: true })
    if (storageErr) {
      console.error('[parse-answers] storage upload 실패:', storageErr)
    } else {
      await supabase.from('week').update({ answer_sheet_path: safeName }).eq('id', weekId)
    }
  } catch (e) {
    console.error('[parse-answers] storage 저장 예외:', e)
  }

  // ── 3. UPSERT: 기존 문항은 정답만 업데이트, 신규 삽입 ────────────────
  const { data: existingQuestions } = await supabase
    .from('exam_question')
    .select('id, question_number, sub_label')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')

  const existingMap = new Map(
    (existingQuestions ?? []).map((q) => [`${q.question_number}|${q.sub_label ?? ''}`, q])
  )
  const parsedKeys = new Set(parsedAnswers.map((a) => `${a.question_number}|${a.sub_label ?? ''}`))

  type QuestionRow = { id: string; question_number: number; sub_label: string | null; question_style: string; correct_answer: number; correct_answer_text: string | null; grading_criteria: string | null }
  const questions: QuestionRow[] = []

  const VALID_STYLES = ['objective', 'subjective', 'ox', 'multi_select', 'find_error'] as const
  type QuestionStyle = typeof VALID_STYLES[number]

  const questionResults = await Promise.all(
    parsedAnswers.map(async (a) => {
      const style: QuestionStyle = VALID_STYLES.includes(a.question_style as QuestionStyle) ? a.question_style as QuestionStyle : 'objective'
      const key = `${a.question_number}|${a.sub_label ?? ''}`
      const existing = existingMap.get(key)

      if (existing) {
        const { data, error } = await supabase
          .from('exam_question')
          .update({ question_style: style, correct_answer: a.correct_answer, correct_answer_text: a.correct_answer_text, grading_criteria: a.grading_criteria, explanation: a.explanation ?? null, question_text: a.question_text ?? null })
          .eq('id', existing.id)
          .select('id, question_number, sub_label, question_style, correct_answer, correct_answer_text, grading_criteria')
          .single()
        if (error) console.error(`[parse-answers] UPDATE 실패 Q${a.question_number}${a.sub_label ?? ''}:`, error)
        return data
      } else {
        const { data, error } = await supabase
          .from('exam_question')
          .insert({ week_id: weekId, exam_type: 'reading', question_number: a.question_number, sub_label: a.sub_label ?? null, question_style: style, correct_answer: a.correct_answer, correct_answer_text: a.correct_answer_text, grading_criteria: a.grading_criteria, explanation: a.explanation ?? null, question_text: a.question_text ?? null })
          .select('id, question_number, sub_label, question_style, correct_answer, correct_answer_text, grading_criteria')
          .single()
        if (error) console.error(`[parse-answers] INSERT 실패 Q${a.question_number}${a.sub_label ?? ''}:`, error)
        return data
      }
    })
  )
  questions.push(...questionResults.filter((d): d is QuestionRow => d !== null))

  // ── 4. 새 해설지에 없는 기존 문항 삭제 (학생 답안 포함) ───────────────
  const removedQuestions = (existingQuestions ?? []).filter(
    (q) => !parsedKeys.has(`${q.question_number}|${q.sub_label ?? ''}`)
  )
  if (removedQuestions.length > 0) {
    const removedIds = removedQuestions.map((q) => q.id)
    await supabase.from('student_answer').delete().in('exam_question_id', removedIds)
    await supabase.from('exam_question_tag').delete().in('exam_question_id', removedIds)
    await supabase.from('exam_question').delete().in('id', removedIds)
  }

  // ── 5. 전체 문항 AI 태그 재연결 (재업로드 시 항상 최신 AI 분석으로 갱신) ──
  const tagInserts: { exam_question_id: string; concept_tag_id: string }[] = []
  for (const q of questions) {
    const parsed = parsedAnswers.find((a) => a.question_number === q.question_number && (a.sub_label ?? null) === q.sub_label)
    const tagId = matchTagId(parsed?.question_type ?? null)
    if (tagId) tagInserts.push({ exam_question_id: q.id, concept_tag_id: tagId })
  }
  // 기존 태그 삭제 후 재삽입
  await supabase.from('exam_question_tag').delete().in('exam_question_id', questions.map((q) => q.id))
  if (tagInserts.length > 0) {
    await supabase.from('exam_question_tag').insert(tagInserts)
  }

  // ── 6. reading_total 자동 업데이트 ────────────────────────────────────
  await supabase.from('week').update({ reading_total: questions.length }).eq('id', weekId)

  // ── 7. 기존 학생 답안 재채점 ──────────────────────────────────────────
  const { data: weekScores } = await supabase
    .from('week_score')
    .select('id, student_id, student_answer(id, exam_question_id, student_answer, student_answer_text, is_correct)')
    .eq('week_id', weekId)

  if (!weekScores?.length) {
    return ok({ ok: true, questions_parsed: questions.length, students_regraded: 0 })
  }

  const studentIds = weekScores.map((s) => s.student_id)
  const { data: students } = await supabase
    .from('student')
    .select('id, name')
    .in('id', studentIds)
  const studentNameMap = new Map((students ?? []).map((s) => [s.id, s.name]))

  const questionByKey = new Map(questions.map((q) => [`${q.question_number}__${q.sub_label ?? ''}`, q]))
  const questionById = new Map(questions.map((q) => [q.id, q]))

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

  function extractCorrection(text: string): string {
    let s = text.trim()
    s = s.replace(/^[a-z]\s*:\s*/i, '')
    s = s.replace(/^\([a-z]\)\s*:?\s*/i, '')
    if (s.includes('→')) s = s.split('→').pop()!
    return s.trim().toLowerCase()
  }

  const subjectiveForGrading: SubjectiveStudentAnswer[] = []

  type FindErrorEntry = {
    answer_id: string
    week_score_id: string
    question_number: number
    student_answer_text: string
    correct_answer_text: string
  }
  const findErrorForGrading: FindErrorEntry[] = []

  await Promise.all(
    weekScores.map(async (score) => {
      type AnswerRow = { id: string; exam_question_id: string; student_answer: number | null; student_answer_text: string | null; ox_selection: string | null; is_correct: boolean }
      const answers: AnswerRow[] = (score.student_answer as unknown as AnswerRow[]) ?? []

      await Promise.all(
        answers.map(async (a) => {
          const q = questionById.get(a.exam_question_id)
          if (!q) return

          if (q.question_style === 'objective') {
            const isCorrect = a.student_answer !== null && a.student_answer === q.correct_answer
            if (isCorrect !== a.is_correct) {
              await supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', a.id)
            }
          } else if (q.question_style === 'ox' && a.ox_selection) {
            const isCorrect = q.correct_answer_text ? gradeOX(q.correct_answer_text, a.ox_selection, a.student_answer_text ?? '') : false
            if (isCorrect !== a.is_correct) {
              await supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', a.id)
            }
          } else if (q.question_style === 'multi_select' && a.student_answer_text?.trim()) {
            const isCorrect = q.correct_answer_text ? gradeMultiSelect(q.correct_answer_text, a.student_answer_text) : false
            if (isCorrect !== a.is_correct) {
              await supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', a.id)
            }
          } else if (q.question_style === 'find_error' && a.student_answer_text !== null) {
            findErrorForGrading.push({
              answer_id: a.id,
              week_score_id: score.id,
              question_number: q.question_number,
              student_answer_text: a.student_answer_text ?? '',
              correct_answer_text: q.correct_answer_text ?? '',
            })
          } else if (q.question_style === 'subjective' && a.student_answer_text?.trim()) {
            subjectiveForGrading.push({
              week_score_id: score.id,
              exam_question_id: a.exam_question_id,
              question_number: q.question_number,
              sub_label: q.sub_label ?? null,
              student_name: studentNameMap.get(score.student_id) ?? score.student_id,
              student_answer_text: a.student_answer_text!.trim(),
            })
          }
        })
      )
    })
  )

  // find_error 코드 레벨 집합 채점 (순서 무관)
  if (findErrorForGrading.length > 0) {
    const feGroups = new Map<string, FindErrorEntry[]>()
    for (const a of findErrorForGrading) {
      const key = `${a.week_score_id}__${a.question_number}`
      feGroups.set(key, [...(feGroups.get(key) ?? []), a])
    }
    for (const group of feGroups.values()) {
      const correctWords = group.map((a) => extractCorrection(a.correct_answer_text))
      const studentWords = group.map((a) => extractCorrection(a.student_answer_text))
      const remaining = [...correctWords]
      const matched = group.map(() => false)
      for (let i = 0; i < group.length; i++) {
        if (!studentWords[i]) continue
        const idx = remaining.indexOf(studentWords[i])
        if (idx !== -1) { matched[i] = true; remaining.splice(idx, 1) }
      }
      await Promise.all(group.map((a, i) =>
        supabase.from('student_answer').update({
          is_correct: matched[i],
          ai_feedback: matched[i] ? '' : `정답: ${correctWords[i]}`,
        }).eq('id', a.answer_id)
      ))
    }
  }

  if (subjectiveForGrading.length > 0) {
    const uniqueKeys = [...new Set(subjectiveForGrading.map((a) => `${a.question_number}__${a.sub_label ?? ''}`))]
    const subjectiveQuestions = uniqueKeys
      .map((key) => {
        const q = questionByKey.get(key)
        return q?.question_style === 'subjective' && q.correct_answer_text
          ? { question_number: q.question_number, sub_label: q.sub_label ?? null, correct_answer_text: q.correct_answer_text, grading_criteria: q.grading_criteria }
          : null
      })
      .filter((q): q is NonNullable<typeof q> => q !== null)

    if (subjectiveQuestions.length > 0) {
      try {
        const gradingResults = await gradeSubjectiveAnswers(subjectiveQuestions, subjectiveForGrading)
        for (const result of gradingResults) {
          await supabase
            .from('student_answer')
            .update({ is_correct: result.is_correct, ai_feedback: result.ai_feedback })
            .eq('week_score_id', result.week_score_id)
            .eq('exam_question_id', result.exam_question_id)
        }
      } catch (e) {
        console.error('[parse-answers] 서술형 AI 채점 실패', e)
        // AI 실패해도 reading_correct는 재계산 (답안 없으면 null)
        await Promise.all(
          weekScores.map(async (score) => {
            const { data: answers } = await supabase
              .from('student_answer')
              .select('is_correct')
              .eq('week_score_id', score.id)
            const readingCorrect = answers && answers.length > 0
              ? answers.filter((a) => a.is_correct).length
              : null
            await supabase.from('week_score').update({ reading_correct: readingCorrect }).eq('id', score.id)
          })
        )
        return ok({ ok: true, questions_parsed: questions.length, students_regraded: weekScores.length, subjective_grading_failed: true })
      }
    }
  }

  // ── 8. reading_correct 재계산 (답안 없으면 null) ───────────────────────
  await Promise.all(
    weekScores.map(async (score) => {
      const { data: answers } = await supabase
        .from('student_answer')
        .select('is_correct')
        .eq('week_score_id', score.id)
      const readingCorrect = answers && answers.length > 0
        ? answers.filter((a) => a.is_correct).length
        : null
      await supabase.from('week_score').update({ reading_correct: readingCorrect }).eq('id', score.id)
    })
  )

  return ok({ ok: true, questions_parsed: questions.length, students_regraded: weekScores.length })
}
