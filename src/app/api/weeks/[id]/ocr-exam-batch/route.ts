import { getAuth, err, ok } from '@/lib/api'
import { ocrExamAnswerBatch, ExamOcrQuestion, type ExamOcrBatchInput } from '@/lib/anthropic'

export const maxDuration = 300

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증이 필요합니다.', 401)

  const body = await request.json() as { files?: unknown }
  const files: unknown[] = Array.isArray(body.files) ? body.files : []
  const normalizedFiles = files.filter((file: unknown): file is ExamOcrBatchInput => (
    !!file &&
    typeof file === 'object' &&
    'fileData' in file &&
    'mimeType' in file &&
    typeof file.fileData === 'string' &&
    typeof file.mimeType === 'string'
  ))

  if (!normalizedFiles.length) return err('업로드할 파일이 없습니다.')

  const { data: questions } = await supabase
    .from('exam_question')
    .select('question_number, sub_label, question_style')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')
    .order('question_number')

  if (!questions?.length) return err('문항이 없습니다.')

  const ocrQuestions: ExamOcrQuestion[] = questions.map((q) => ({
    question_number: q.question_number,
    sub_label: q.sub_label ?? null,
    question_style: q.question_style as ExamOcrQuestion['question_style'],
  }))

  try {
    const { results, pagesProcessed } = await ocrExamAnswerBatch(normalizedFiles, ocrQuestions)
    return ok({ ok: true, results, pages_processed: pagesProcessed })
  } catch (e) {
    console.error('[ocr-exam-batch] OCR 실패', e)
    return err('시험지 OCR에 실패했습니다. 파일 순서와 해상도를 확인해주세요.')
  }
}
