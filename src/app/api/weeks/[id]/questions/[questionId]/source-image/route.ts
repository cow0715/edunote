import { assertWeekOwner, err, getAuth, getTeacherId, ok } from '@/lib/api'
import { generateSourceImageForQuestion } from '@/lib/week-reading-import'

type QuestionRow = {
  id: string
  week_id: string
  needs_source_image: boolean | null
  source_page: number | null
  source_bbox: { x: number; y: number; width: number; height: number } | null
}

export const maxDuration = 120

export async function POST(_: Request, { params }: { params: Promise<{ id: string; questionId: string }> }) {
  try {
    const { supabase, user } = await getAuth()
    const { id: weekId, questionId } = await params
    if (!user) return err('인증 필요', 401)

    const teacherId = await getTeacherId(supabase, user.id)
    if (!teacherId) return err('강사 정보 없음', 404)
    if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)

    const { data: week, error: weekError } = await supabase
      .from('week')
      .select('id, answer_sheet_path')
      .eq('id', weekId)
      .single()

    if (weekError || !week) return err(weekError?.message ?? '주차를 찾을 수 없습니다.', 404)
    if (!week.answer_sheet_path) return err('저장된 원본 PDF가 없습니다. 시험지를 다시 가져와 주세요.', 422)

    const { data: question, error: questionError } = await supabase
      .from('exam_question')
      .select('id, week_id, needs_source_image, source_page, source_bbox')
      .eq('id', questionId)
      .eq('week_id', weekId)
      .single()

    if (questionError || !question) return err(questionError?.message ?? '문항을 찾을 수 없습니다.', 404)

    const row = question as QuestionRow
    if (!row.needs_source_image) return err('원본 이미지가 필요한 문항이 아닙니다.', 422)
    if (!row.source_page) return err('원본 페이지 정보가 없습니다. 시험지를 다시 가져와 주세요.', 422)

    const { data: file, error: downloadError } = await supabase.storage
      .from('answer-sheets')
      .download(week.answer_sheet_path)

    if (downloadError || !file) return err(downloadError?.message ?? '원본 PDF 다운로드 실패', 500)

    const fileData = Buffer.from(await file.arrayBuffer()).toString('base64')
    const result = await generateSourceImageForQuestion(supabase, weekId, fileData, {
      id: row.id,
      source_page: row.source_page,
      source_bbox: row.source_bbox,
    })

    if (result.error || !result.storagePath) return err(result.error ?? '원본 이미지 생성 실패', 500)

    return ok({ ok: true, source_image_path: result.storagePath })
  } catch (error) {
    console.error('[generate-question-source-image] unhandled error:', error)
    return err(error instanceof Error ? error.message : '원본 이미지 생성 실패', 500)
  }
}
