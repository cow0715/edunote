import { err, getAuth, getTeacherId, ok } from '@/lib/api'
import { ocrExamOmrBatch, type ExamOcrBatchInput, type ExamOcrQuestion, type ExamOmrPageResult } from '@/lib/anthropic'
import { assertMockExamOwner, assertMockExamStudentAllowed } from '@/lib/mock-exam-server'

type OcrRequestBody = {
  student_id?: string
  files?: ExamOcrBatchInput[]
}

export const maxDuration = 300

function buildAnswerPayload(results: ExamOmrPageResult[], questions: ExamOcrQuestion[]) {
  const answerMap = new Map<number, number | null>()

  for (const page of results) {
    for (const answer of page.answers) {
      const current = answerMap.get(answer.question_number)
      if (current == null && answer.student_answer != null) {
        answerMap.set(answer.question_number, answer.student_answer)
      } else if (!answerMap.has(answer.question_number)) {
        answerMap.set(answer.question_number, null)
      }
    }
  }

  return questions.map((question) => ({
    question_number: question.question_number,
    student_answer: answerMap.get(question.question_number) ?? null,
  }))
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보를 찾을 수 없습니다', 404)

  const { id } = await params
  if (!(await assertMockExamOwner(supabase, id, teacherId))) return err('접근 권한이 없습니다', 403)

  const body = await request.json() as OcrRequestBody
  if (!body.student_id) return err('학생을 선택해 주세요')
  const files = Array.isArray(body.files) ? body.files : []
  const normalizedFiles = files.filter((file): file is ExamOcrBatchInput => (
    !!file &&
    typeof file.fileData === 'string' &&
    typeof file.mimeType === 'string'
  ))
  if (normalizedFiles.length === 0) return err('업로드할 답안지 파일이 없습니다')

  const [{ data: exam }, { data: questions }] = await Promise.all([
    supabase.from('mock_exam').select('class_id, exam_date').eq('id', id).single(),
    supabase
      .from('mock_exam_question')
      .select('question_number')
      .eq('mock_exam_id', id)
      .eq('is_void', false)
      .order('question_number'),
  ])

  if (!exam) return err('모의고사를 찾을 수 없습니다', 404)
  if (!(await assertMockExamStudentAllowed(supabase, body.student_id, teacherId, exam.class_id, exam.exam_date))) {
    return err('학생 접근 권한이 없습니다', 403)
  }
  if (!questions?.length) return err('등록된 문항이 없습니다')

  const { data: job, error: jobError } = await supabase
    .from('mock_exam_ocr_job')
    .insert({
      mock_exam_id: id,
      student_id: body.student_id,
      status: 'processing',
      file_names: normalizedFiles.map((file) => file.fileName ?? 'answer-sheet'),
    })
    .select()
    .single()
  if (jobError) return err(jobError.message, 500)

  const ocrQuestions: ExamOcrQuestion[] = questions.map((question) => ({
    question_number: question.question_number,
    sub_label: null,
    question_style: 'objective',
  }))

  try {
    const { results, pagesProcessed } = await ocrExamOmrBatch(normalizedFiles, ocrQuestions)
    const answerPayload = buildAnswerPayload(results, ocrQuestions)
    const answeredCount = answerPayload.filter((answer) => answer.student_answer != null).length

    const saveResponse = await fetch(new URL(`/api/mock-exams/${id}/results`, request.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: request.headers.get('cookie') ?? '',
      },
      body: JSON.stringify({
        student_id: body.student_id,
        answers: answerPayload,
      }),
    })
    const saveData = await saveResponse.json().catch(() => null)
    if (!saveResponse.ok) {
      throw new Error(saveData?.error ?? 'OCR 결과 저장 실패')
    }

    await supabase
      .from('mock_exam_ocr_job')
      .update({
        status: 'review_required',
        pages_processed: pagesProcessed,
        ocr_raw_json: results,
        confidence: questions.length > 0 ? Math.min(100, Math.round((answeredCount / questions.length) * 100)) : 0,
      })
      .eq('id', job.id)

    return ok({ ok: true, job_id: job.id, results: answerPayload, omr_pages: results, pages_processed: pagesProcessed })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OCR 처리 실패'
    await supabase
      .from('mock_exam_ocr_job')
      .update({ status: 'failed', error_message: message })
      .eq('id', job.id)

    return err(message, 500)
  }
}
