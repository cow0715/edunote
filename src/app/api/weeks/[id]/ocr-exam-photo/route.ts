import { getAuth, err, ok } from '@/lib/api'
import { ocrExamAnswers, ExamOcrQuestion } from '@/lib/anthropic'
import { oxNotation } from '@/lib/ox-grading'

export const maxDuration = 60

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

  const { fileData, mimeType } = await request.json()
  if (!fileData || !mimeType) return err('파일 없음')

  const { data: questions } = await supabase
    .from('exam_question')
    .select('question_number, sub_label, question_style, correct_answer_text')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')
    .order('question_number')

  if (!questions?.length) return err('문항 없음')

  const ocrQuestions: ExamOcrQuestion[] = questions.map((q) => ({
    question_number: q.question_number,
    sub_label: q.sub_label ?? null,
    question_style: q.question_style as ExamOcrQuestion['question_style'],
    // T/F 판단형 답안지는 모델에게 T/F 로 읽으라고 알려준다 (O/X 로 오인 방지)
    ...(q.question_style === 'ox' && { ox_notation: oxNotation(q.correct_answer_text) }),
  }))

  try {
    const results = await ocrExamAnswers(fileData, mimeType, ocrQuestions)
    return ok({ ok: true, results })
  } catch (e) {
    console.error('[ocr-exam-photo] OCR 실패', e)
    return err('OCR 실패. 사진을 다시 찍어주세요.')
  }
}
