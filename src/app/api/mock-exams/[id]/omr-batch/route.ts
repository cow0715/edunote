import { err, getAuth, getTeacherId, ok } from '@/lib/api'
import { ocrExamOmrBatch, type ExamOcrBatchInput, type ExamOcrQuestion, type ExamOmrAnswer } from '@/lib/anthropic'
import { calculateMockExamScore, type MockExamQuestionForGrading } from '@/lib/mock-exam'
import { assertMockExamOwner } from '@/lib/mock-exam-server'

type OmrBatchRequestBody = {
  files?: ExamOcrBatchInput[]
}

type StudentCandidate = {
  id: string
  name: string
  school: string | null
  grade: string | null
  score: number
}

type StudentRow = {
  id: string
  name: string
  school: string | null
  grade: string | null
  class_student?: { left_at: string | null }[] | null
}

type ExamRow = {
  grade: number | null
  grade_cutoffs: Record<string, number> | null
}

export const maxDuration = 300

function normalizeGrade(value: string | number | null | undefined) {
  const match = String(value ?? '').match(/[1-3]/)
  return match?.[0] ?? ''
}

function normalizeName(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase()
}

function levenshtein(a: string, b: string) {
  const left = Array.from(a)
  const right = Array.from(b)
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0))

  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      )
    }
  }

  return dp[left.length][right.length]
}

function nameScore(ocrName: string | null, studentName: string) {
  const ocr = normalizeName(ocrName)
  const candidate = normalizeName(studentName)
  if (!ocr || !candidate) return 0
  if (ocr === candidate) return 100
  if (ocr.includes(candidate) || candidate.includes(ocr)) return 92

  const maxLength = Math.max(Array.from(ocr).length, Array.from(candidate).length)
  const distance = levenshtein(ocr, candidate)
  return Math.max(0, Math.round((1 - distance / Math.max(maxLength, 1)) * 100))
}

function matchStudent(ocrName: string | null, students: StudentRow[]): StudentCandidate[] {
  return students
    .map((student) => ({
      id: student.id,
      name: student.name,
      school: student.school,
      grade: student.grade,
      score: nameScore(ocrName, student.name),
    }))
    .filter((student) => student.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ko'))
    .slice(0, 5)
}

function answersForSave(answers: ExamOmrAnswer[]) {
  return answers.map((answer) => ({
    question_number: answer.question_number,
    student_answer: answer.student_answer,
  }))
}

async function saveResult(
  supabase: Awaited<ReturnType<typeof getAuth>>['supabase'],
  examId: string,
  studentId: string,
  questions: MockExamQuestionForGrading[],
  gradeCutoffs: Record<string, number> | null,
  answers: ExamOmrAnswer[],
) {
  const score = calculateMockExamScore(questions, answersForSave(answers), gradeCutoffs)
  const { data: result, error: resultError } = await supabase
    .from('mock_exam_result')
    .upsert({
      mock_exam_id: examId,
      student_id: studentId,
      raw_score: score.raw_score,
      grade: score.grade,
      listening_correct: score.listening_correct,
      listening_total: score.listening_total,
      reading_correct: score.reading_correct,
      reading_total: score.reading_total,
      type_analysis: score.type_analysis,
      teacher_comment: null,
      status: 'draft',
    }, { onConflict: 'mock_exam_id,student_id' })
    .select()
    .single()

  if (resultError) throw new Error(resultError.message)

  const { error: answerError } = await supabase
    .from('mock_exam_student_answer')
    .upsert(
      score.answer_rows.map((answer) => ({ mock_exam_result_id: result.id, ...answer })),
      { onConflict: 'mock_exam_result_id,mock_exam_question_id' },
    )

  if (answerError) throw new Error(answerError.message)
  return result
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증이 필요합니다', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보를 찾을 수 없습니다', 404)

  const { id } = await params
  if (!(await assertMockExamOwner(supabase, id, teacherId))) return err('접근 권한이 없습니다', 403)

  const body = await request.json() as OmrBatchRequestBody
  const files = (Array.isArray(body.files) ? body.files : []).filter((file): file is ExamOcrBatchInput => (
    !!file &&
    typeof file.fileData === 'string' &&
    typeof file.mimeType === 'string'
  ))
  if (files.length === 0) return err('업로드할 OMR 파일이 없습니다')

  const [{ data: exam }, { data: questions, error: questionError }, { data: students, error: studentError }] = await Promise.all([
    supabase.from('mock_exam').select('grade, grade_cutoffs').eq('id', id).single(),
    supabase.from('mock_exam_question').select('*').eq('mock_exam_id', id).order('question_number'),
    supabase
      .from('student')
      .select('id, name, school, grade, class_student(left_at)')
      .eq('teacher_id', teacherId)
      .order('name'),
  ])

  if (!exam) return err('모의고사를 찾을 수 없습니다', 404)
  if (questionError) return err(questionError.message, 500)
  if (studentError) return err(studentError.message, 500)

  const questionRows = (questions ?? []) as MockExamQuestionForGrading[]
  if (questionRows.length === 0) return err('등록된 문항이 없습니다')

  const examGrade = normalizeGrade((exam as ExamRow).grade)
  const activeStudents = ((students ?? []) as StudentRow[]).filter((student) => (
    normalizeGrade(student.grade) === examGrade &&
    (student.class_student ?? []).some((enrollment) => enrollment.left_at === null)
  ))
  if (activeStudents.length === 0) return err('현재 재원중인 해당 학년 학생이 없습니다')

  const ocrQuestions: ExamOcrQuestion[] = questionRows
    .filter((question) => !question.is_void)
    .map((question) => ({
      question_number: question.question_number,
      sub_label: null,
      question_style: 'objective',
    }))

  const { results, pagesProcessed } = await ocrExamOmrBatch(files, ocrQuestions)
  const usedStudentIds = new Set<string>()
  let savedCount = 0

  const items = []
  for (const page of results) {
    const candidates = matchStudent(page.student_name, activeStudents)
    const best = candidates[0] ?? null
    const second = candidates[1] ?? null
    const answeredCount = page.answers.filter((answer) => answer.student_answer != null).length
    const warnings = [...page.warnings]
    const canAutoSave = (
      best &&
      best.score >= 88 &&
      (!second || best.score - second.score >= 8) &&
      page.confidence >= 0.7 &&
      answeredCount >= Math.min(30, ocrQuestions.length) &&
      !usedStudentIds.has(best.id)
    )

    if (!best) warnings.push('학생 이름을 재원생 목록과 매칭하지 못했습니다.')
    if (best && usedStudentIds.has(best.id)) warnings.push('같은 학생으로 매칭된 다른 페이지가 있어 검수가 필요합니다.')
    if (best && second && best.score - second.score < 8) warnings.push('비슷한 이름의 학생 후보가 있어 검수가 필요합니다.')
    if (page.confidence < 0.7) warnings.push('OMR 인식 신뢰도가 낮아 검수가 필요합니다.')

    if (canAutoSave) {
      try {
        const result = await saveResult(
          supabase,
          id,
          best.id,
          questionRows,
          (exam as ExamRow).grade_cutoffs,
          page.answers,
        )
        usedStudentIds.add(best.id)
        savedCount += 1
        items.push({
          ...page,
          answered_count: answeredCount,
          status: 'saved',
          matched_student_id: best.id,
          matched_student_name: best.name,
          match_score: best.score,
          candidates,
          result,
          warnings,
        })
        continue
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : '성적 저장에 실패했습니다.')
      }
    }

    items.push({
      ...page,
      answered_count: answeredCount,
      status: 'review_required',
      matched_student_id: best?.id ?? null,
      matched_student_name: best?.name ?? null,
      match_score: best?.score ?? 0,
      candidates,
      warnings,
    })
  }

  return ok({
    pages_processed: pagesProcessed,
    saved_count: savedCount,
    review_count: items.filter((item) => item.status !== 'saved').length,
    items,
  })
}
