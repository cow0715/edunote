import { assertWeekOwner, getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import {
  createTagMatcher,
  fetchTeacherTagContext,
  parseAnswerSheetDocument,
  saveWeekAnswerSheetFile,
  syncWeekReadingQuestionsAndRegrade,
} from '@/lib/week-reading-import'

export const maxDuration = 300

type ParseMode = 'auto' | 'answer_sheet' | 'problem_sheet'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await getAuth()
    const { id: weekId } = await params
    if (!user) return err('인증이 필요합니다.', 401)

    const teacherId = await getTeacherId(supabase, user.id)
    if (!teacherId) return err('강사 정보를 찾지 못했습니다.', 404)
    if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한이 없습니다.', 403)

    const { tagList, tagCategories } = await fetchTeacherTagContext(supabase, teacherId)
    const matchTagId = createTagMatcher(tagList)

    const body = await request.json()
    const { mimeType, fileName } = body
    let fileData = body.fileData as string | undefined
    const requestedMode = (body.parseMode === 'answer_sheet' || body.parseMode === 'problem_sheet' || body.parseMode === 'auto'
      ? body.parseMode
      : 'auto') as ParseMode

    // 큰 파일은 body(4.5MB 제한) 대신 임시 스토리지 경유 — 감지 단계에서 올린 파일 재사용
    const storagePath = typeof body.storagePath === 'string' ? body.storagePath : null
    if (!fileData && storagePath) {
      const serviceClient = createServiceClient()
      const { data, error } = await serviceClient.storage.from('exam-pdf-temp').download(storagePath)
      if (error || !data) return err(`파일 다운로드 실패: ${error?.message ?? storagePath}`)
      fileData = Buffer.from(await data.arrayBuffer()).toString('base64')
      void serviceClient.storage.from('exam-pdf-temp').remove([storagePath]).catch(() => {})
    }

    if (!fileData || !mimeType) return err('파일이 없습니다.')
    if (requestedMode === 'problem_sheet') {
      return err('문제지형 PDF는 시험지 가져오기를 사용해 주세요.', 422)
    }

    let parsedAnswers
    let skippedPages: number[] = []
    try {
      const parsed = await parseAnswerSheetDocument([{ fileData, mimeType, fileName }], tagCategories)
      parsedAnswers = parsed.answers
      skippedPages = parsed.skipped.map((entry) => entry.startPage)
    } catch (error) {
      const message = error instanceof Error ? error.message : '해설지 파싱에 실패했습니다.'
      return err(message || '해설 포함 PDF로 파싱하지 못했습니다.', 422)
    }

    if (!parsedAnswers.length) {
      return err('문항을 찾을 수 없습니다.', 422)
    }

    await saveWeekAnswerSheetFile(supabase, weekId, fileData, mimeType, fileName)
    const result = await syncWeekReadingQuestionsAndRegrade({
      supabase,
      weekId,
      parsedAnswers,
      matchTagId,
    })

    // 해설 안전망(빈 해설 채우기)은 여기서 돌리지 않는다 — 파싱 209초 + 해설 생성이 한 함수에
    // 합산되면 300초를 넘을 수 있어, 클라이언트가 explanations-drain 을 이어서 호출한다.
    return ok({
      ok: true,
      ...result,
      parse_mode_used: 'answer_sheet',
      skipped_pages: skippedPages,
    })
  } catch (error) {
    console.error('[parse-answers] unhandled error:', error)
    const message = error instanceof Error ? error.message : '서버 처리 중 오류가 발생했습니다.'
    return err(message, 500)
  }
}
