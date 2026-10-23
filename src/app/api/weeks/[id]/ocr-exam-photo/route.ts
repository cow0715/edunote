import { sortQuestionsByPdf } from '@/lib/question-presentation'
import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import { ocrExamAnswers, ExamOcrQuestion } from '@/lib/anthropic'
import { oxNotation } from '@/lib/ox-grading'
import { EXAM_PHOTO_BUCKET } from '@/lib/photo-buckets'

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

  if (!studentId) return err('사진을 저장할 학생을 선택해주세요.')
  const { data: weekRow, error: weekError } = await supabase
    .from('week').select('class_id').eq('id', weekId).single()
  if (weekError || !weekRow) return err('사진을 저장할 수업을 확인하지 못했습니다.', 503)
  const { data: classStudent, error: studentError } = await supabase
    .from('class_student').select('student_id')
    .eq('class_id', weekRow.class_id).eq('student_id', studentId).maybeSingle()
  if (studentError) return err('학생 연결 정보를 확인하지 못했습니다. 다시 시도해주세요.', 503)
  if (!classStudent) return err('해당 수업 학생이 아닙니다.', 403)
  const storagePath = `${weekId}/${studentId}`

  // 판독할 이미지: 업로드 파일 또는 저장된 사진
  let imageData = fileData ?? null
  let imageMime = mimeType ?? null
  if (useStored) {
    const { data: blob, error: downloadError } = await supabase.storage
      .from(EXAM_PHOTO_BUCKET)
      .download(storagePath)
    if (downloadError || !blob) return err('저장된 답안지 사진이 없습니다', 404)
    imageData = Buffer.from(await blob.arrayBuffer()).toString('base64')
    imageMime = blob.type || 'image/jpeg'
  }
  if (!imageData || !imageMime) return err('파일 없음')

  // OCR보다 먼저 보관한다. 저장 실패를 OCR 성공으로 가리지 않는다.
  if (!useStored) {
    try {
      const { error: uploadError } = await supabase.storage
        .from(EXAM_PHOTO_BUCKET)
        .upload(storagePath, Buffer.from(imageData, 'base64'), { contentType: imageMime, upsert: true })
      if (uploadError) {
        console.error('[ocr-exam-photo] 사진 업로드 실패', uploadError)
        return err('답안지 사진 저장에 실패했습니다. 판독을 시작하지 않았습니다. 사진을 다시 업로드해주세요.', 503)
      }
    } catch (e) {
      console.error('[ocr-exam-photo] 사진 업로드 예외', e)
      return err('답안지 사진 저장에 실패했습니다. 판독을 시작하지 않았습니다. 사진을 다시 업로드해주세요.', 503)
    }
    try {
      const { data: linked, error: linkError } = await supabase
        .from('week_score')
        .upsert({ week_id: weekId, student_id: studentId, exam_photo_path: storagePath }, { onConflict: 'week_id,student_id' })
        .select('exam_photo_path')
        .single()
      if (linkError || linked?.exam_photo_path !== storagePath) {
        console.error('[ocr-exam-photo] 학생 사진 연결 실패', linkError)
        return err('사진 파일은 저장됐지만 학생과 연결하지 못했습니다. 판독을 시작하지 않았습니다. 같은 학생으로 다시 업로드해주세요.', 503)
      }
    } catch (e) {
      console.error('[ocr-exam-photo] 학생 사진 연결 예외', e)
      return err('사진 파일은 저장됐지만 학생과 연결하지 못했습니다. 판독을 시작하지 않았습니다. 같은 학생으로 다시 업로드해주세요.', 503)
    }
  }

  const { data: questions } = await supabase
    .from('exam_question')
    .select('question_number, sub_label, question_style, correct_answer_text, source_section, source_question_number, display_order')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')
    .order('question_number')

  if (!questions?.length) return err('사진은 저장돼 있습니다. 판독할 문항이 없습니다.')

  const ocrQuestions: ExamOcrQuestion[] = sortQuestionsByPdf(questions).map((q) => ({
    question_number: q.question_number,
    source_section: q.source_section,
    source_question_number: q.source_question_number,
    display_order: q.display_order,
    sub_label: q.sub_label ?? null,
    question_style: q.question_style as ExamOcrQuestion['question_style'],
    // T/F 판단형 답안지는 모델에게 T/F 로 읽으라고 알려준다 (O/X 로 오인 방지)
    ...(q.question_style === 'ox' && { ox_notation: oxNotation(q.correct_answer_text) }),
  }))

  try {
    const results = await ocrExamAnswers(imageData, imageMime, ocrQuestions)

    return ok({ ok: true, results, photoPath: storagePath })
  } catch (e) {
    console.error('[ocr-exam-photo] OCR 실패', e)
    return err('사진은 저장됐지만 OCR 판독에 실패했습니다. 저장된 사진으로 재판독하거나 다시 업로드해주세요.', 502)
  }
}
