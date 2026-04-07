import { getAuth, err, ok } from '@/lib/api'
import { ocrExamAnswers, ExamOcrQuestion } from '@/lib/anthropic'

export const maxDuration = 60

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

  const { files } = await request.json()
  if (!files?.length) return err('파일 없음')

  const { data: questions } = await supabase
    .from('exam_question')
    .select('question_number, sub_label, question_style')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')
    .order('question_number')

  if (!questions?.length) return err('문항 없음')

  const ocrQuestions: ExamOcrQuestion[] = questions.map((q) => ({
    question_number: q.question_number,
    sub_label: q.sub_label ?? null,
    question_style: q.question_style as ExamOcrQuestion['question_style'],
  }))

  try {
    const results = await ocrExamAnswers(files, ocrQuestions)
    return ok({ ok: true, results })
  } catch (e) {
    console.error('[ocr-exam-photo] OCR 실패', e)
    return err('OCR 실패. 사진을 다시 찍어주세요.')
  }
}
