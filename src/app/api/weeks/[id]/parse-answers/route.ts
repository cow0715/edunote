import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { parseAnswerSheet, gradeSubjectiveAnswers, SubjectiveStudentAnswer, TagCategory } from '@/lib/anthropic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: weekId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { data: teacher } = await supabase.from('teacher').select('id').eq('auth_id', user.id).single()
  const teacherId = teacher?.id ?? null

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
  if (!fileData || !mimeType) return NextResponse.json({ error: '파일 없음' }, { status: 400 })

  // ── 1. 해설지 파싱 ────────────────────────────────────────────────────
  let parsedAnswers
  try {
    parsedAnswers = await parseAnswerSheet(fileData, mimeType, tagCategories)
  } catch (e) {
    console.error('[parse-answers] 파싱 실패', e)
    return NextResponse.json({ error: '해설지 파싱 실패. 파일을 확인해주세요.' }, { status: 422 })
  }

  if (!parsedAnswers.length) {
    return NextResponse.json({ error: '문항을 찾을 수 없습니다' }, { status: 422 })
  }

  // ── 2. 파일 Storage 저장 (실패해도 파싱 계속) ─────────────────────────
  try {
    const safeName = (fileName as string | undefined)?.replace(/[/\\?%*:|"<>]/g, '_') ?? `${weekId}.bin`
    const filePath = safeName

    const fileBuffer = Buffer.from(fileData, 'base64')
    const { error: storageErr } = await supabase.storage
      .from('answer-sheets')
      .upload(filePath, fileBuffer, { contentType: mimeType, upsert: true })
    if (storageErr) {
      console.error('[parse-answers] storage upload 실패:', storageErr)
    } else {
      const { error: weekErr } = await supabase.from('week').update({ answer_sheet_path: filePath }).eq('id', weekId)
      if (weekErr) console.error('[parse-answers] week update 실패:', weekErr)
    }
  } catch (e) {
    console.error('[parse-answers] storage 저장 예외:', e)
  }

  // ── 3. UPSERT: question_number 기준으로 업데이트, 신규만 삽입 ──────────
  const { data: existingQuestions } = await supabase
    .from('exam_question')
    .select('id, question_number')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')

  const existingMap = new Map((existingQuestions ?? []).map((q) => [q.question_number, q]))
  const parsedNumbers = new Set(parsedAnswers.map((a) => a.question_number))

  type QuestionRow = { id: string; question_number: number; question_style: string; correct_answer: number; correct_answer_text: string | null; grading_criteria: string | null }
  const questions: QuestionRow[] = []

  for (const a of parsedAnswers) {
    const style = (['objective', 'subjective'] as const).includes(a.question_style) ? a.question_style : 'objective'
    const existing = existingMap.get(a.question_number)

    if (existing) {
      // 기존 문항 UPDATE (정답/스타일만 — 태그는 사용자 설정 유지)
      const { data } = await supabase
        .from('exam_question')
        .update({ question_style: style, correct_answer: a.correct_answer, correct_answer_text: a.correct_answer_text, grading_criteria: a.grading_criteria })
        .eq('id', existing.id)
        .select('id, question_number, question_style, correct_answer, correct_answer_text, grading_criteria')
        .single()
      if (data) questions.push(data)
    } else {
      // 신규 문항 INSERT
      const { data } = await supabase
        .from('exam_question')
        .insert({ week_id: weekId, exam_type: 'reading', question_number: a.question_number, question_style: style, correct_answer: a.correct_answer, correct_answer_text: a.correct_answer_text, grading_criteria: a.grading_criteria })
        .select('id, question_number, question_style, correct_answer, correct_answer_text, grading_criteria')
        .single()
      if (data) questions.push(data)
    }
  }

  // 새 해설지에 없는 기존 문항: 학생 답안 없는 것만 삭제
  for (const existing of existingQuestions ?? []) {
    if (parsedNumbers.has(existing.question_number)) continue
    const { count } = await supabase
      .from('student_answer')
      .select('*', { count: 'exact', head: true })
      .eq('exam_question_id', existing.id)
    if ((count ?? 0) === 0) {
      await supabase.from('exam_question').delete().eq('id', existing.id)
    }
  }

  // 신규 문항에만 AI 태그 연결 (기존 문항 태그는 사용자 설정 유지)
  const newlyInserted = questions.filter((q) => !existingMap.has(q.question_number))
  const tagInserts: { exam_question_id: string; concept_tag_id: string }[] = []
  for (const q of newlyInserted) {
    const parsed = parsedAnswers.find((a) => a.question_number === q.question_number)
    const tagId = matchTagId(parsed?.question_type ?? null)
    if (tagId) tagInserts.push({ exam_question_id: q.id, concept_tag_id: tagId })
  }
  if (tagInserts.length > 0) {
    await supabase.from('exam_question_tag').insert(tagInserts)
  }

  // ── 4. 기존 학생 답안 재채점 ──────────────────────────────────────────
  const { data: weekScores } = await supabase
    .from('week_score')
    .select('id, student_id, student_answer(id, exam_question_id, student_answer, student_answer_text, is_correct)')
    .eq('week_id', weekId)

  if (!weekScores?.length) {
    return NextResponse.json({ ok: true, questions_parsed: questions.length, students_regraded: 0 })
  }

  const studentIds = weekScores.map((s) => s.student_id)
  const { data: students } = await supabase
    .from('student')
    .select('id, name')
    .in('id', studentIds)
  const studentNameMap = new Map((students ?? []).map((s) => [s.id, s.name]))

  const questionByNumber = new Map(questions.map((q) => [q.question_number, q]))
  const questionById = new Map(questions.map((q) => [q.id, q]))

  const OX_PATTERN = /^[OX](\s*\(.+\))?$/i

  function gradeOX(correctAnswerText: string, studentAnswerText: string): boolean {
    const correct = correctAnswerText.trim()
    const student = studentAnswerText.trim()
    if (/^O$/i.test(correct)) return /^o$/i.test(student)
    const correction = correct.match(/\((.+)\)/)?.[1]?.trim().toLowerCase()
    if (/^o$/i.test(student)) return false
    return !!correction && student.toLowerCase() === correction
  }

  const subjectiveForGrading: SubjectiveStudentAnswer[] = []

  for (const score of weekScores) {
    type AnswerRow = { id: string; exam_question_id: string; student_answer: number | null; student_answer_text: string | null; is_correct: boolean }
    const answers: AnswerRow[] = (score.student_answer as unknown as AnswerRow[]) ?? []

    for (const a of answers) {
      const q = questionById.get(a.exam_question_id)
      if (!q) continue

      if (q.question_style === 'objective') {
        const isCorrect = a.student_answer !== null && a.student_answer === q.correct_answer
        if (isCorrect !== a.is_correct) {
          await supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', a.id)
        }
      } else if (q.question_style === 'subjective' && a.student_answer_text?.trim()) {
        const isOX = q.correct_answer_text && OX_PATTERN.test(q.correct_answer_text.trim())
        if (isOX) {
          const isCorrect = gradeOX(q.correct_answer_text!, a.student_answer_text)
          if (isCorrect !== a.is_correct) {
            await supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', a.id)
          }
        } else {
          subjectiveForGrading.push({
            week_score_id: score.id,
            exam_question_id: a.exam_question_id,
            question_number: q.question_number,
            student_name: studentNameMap.get(score.student_id) ?? score.student_id,
            student_answer_text: a.student_answer_text!.trim(),
          })
        }
      }
    }
  }

  if (subjectiveForGrading.length > 0) {
    const subjectiveQuestions = [...new Set(subjectiveForGrading.map((a) => a.question_number))]
      .map((qNum) => {
        const q = questionByNumber.get(qNum)
        return q?.question_style === 'subjective' && q.correct_answer_text
          ? { question_number: q.question_number, correct_answer_text: q.correct_answer_text, grading_criteria: q.grading_criteria }
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
        return NextResponse.json({ ok: true, questions_parsed: questions.length, students_regraded: weekScores.length, subjective_grading_failed: true })
      }
    }
  }

  return NextResponse.json({ ok: true, questions_parsed: questions.length, students_regraded: weekScores.length })
}
