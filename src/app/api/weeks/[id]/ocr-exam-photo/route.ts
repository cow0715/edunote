import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import { ocrExamAnswers, ExamOcrQuestion } from '@/lib/anthropic'
import { oxNotation } from '@/lib/ox-grading'
import { EXAM_PHOTO_BUCKET } from '@/lib/vocab-photo-retention'

export const maxDuration = 60

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

  const { fileData, mimeType, studentId, useStored } = await request.json() as {
    fileData?: string
    mimeType?: string
    studentId?: string
    /** true 면 파일 대신 저장된 사진(exam-photos/{weekId}/{studentId})으로 재판독 */
    useStored?: boolean
  }
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)

  const storagePath = studentId ? `${weekId}/${studentId}` : null

  // 판독할 이미지: 업로드 파일 또는 저장된 사진
  let imageData = fileData ?? null
  let imageMime = mimeType ?? null
  if (useStored) {
    if (!storagePath) return err('studentId 필요')
    const { data: blob, error: downloadError } = await supabase.storage
      .from(EXAM_PHOTO_BUCKET)
      .download(storagePath)
    if (downloadError || !blob) return err('저장된 답안지 사진이 없습니다', 404)
    imageData = Buffer.from(await blob.arrayBuffer()).toString('base64')
    imageMime = blob.type || 'image/jpeg'
  }
  if (!imageData || !imageMime) return err('파일 없음')

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
    const results = await ocrExamAnswers(imageData, imageMime, ocrQuestions)

    // 새로 업로드한 사진은 저장해 둔다 — 판독이 틀렸을 때 원본 확인·재판독의 유일한 복구 수단.
    // 경로는 확장자 없이 {weekId}/{studentId} (vocab-photos 와 같은 규칙 — 재촬영 시 진짜 upsert).
    // 저장 실패는 판독 결과에 영향 주지 않는다.
    if (!useStored && storagePath) {
      try {
        const buffer = Buffer.from(imageData, 'base64')
        const { error: uploadError } = await supabase.storage
          .from(EXAM_PHOTO_BUCKET)
          .upload(storagePath, buffer, { contentType: imageMime, upsert: true })
        if (!uploadError) {
          await supabase
            .from('week_score')
            .upsert({ week_id: weekId, student_id: studentId, exam_photo_path: storagePath }, { onConflict: 'week_id,student_id' })
        } else {
          console.error('[ocr-exam-photo] 사진 업로드 실패', uploadError)
        }
      } catch (e) {
        console.error('[ocr-exam-photo] 사진 업로드 예외', e)
      }
    }

    return ok({ ok: true, results })
  } catch (e) {
    console.error('[ocr-exam-photo] OCR 실패', e)
    return err('OCR 실패. 사진을 다시 찍어주세요.')
  }
}
