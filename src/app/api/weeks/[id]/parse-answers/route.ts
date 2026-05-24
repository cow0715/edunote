import { assertWeekOwner, getAuth, getTeacherId, err, ok } from '@/lib/api'
import { parseAnswerSheet } from '@/lib/anthropic'
import {
  createTagMatcher,
  fetchTeacherTagContext,
  normalizeParsedAnswers,
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
    const { fileData, mimeType, fileName } = body
    const requestedMode = (body.parseMode === 'answer_sheet' || body.parseMode === 'problem_sheet' || body.parseMode === 'auto'
      ? body.parseMode
      : 'auto') as ParseMode

    if (!fileData || !mimeType) return err('파일이 없습니다.')
    if (requestedMode === 'problem_sheet') {
      return err('문제지형 PDF는 시험지 가져오기를 사용해 주세요.', 422)
    }

    let parsedAnswers
    try {
      parsedAnswers = normalizeParsedAnswers(await parseAnswerSheet(fileData, mimeType, tagCategories))
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

    return ok({
      ok: true,
      ...result,
      parse_mode_used: 'answer_sheet',
    })
  } catch (error) {
    console.error('[parse-answers] unhandled error:', error)
    const message = error instanceof Error ? error.message : '서버 처리 중 오류가 발생했습니다.'
    return err(message, 500)
  }
}
