import { assertWeekOwner, getAuth, getTeacherId, err, ok } from '@/lib/api'
import {
  createTagMatcher,
  fetchTeacherTagContext,
  normalizeParsedAnswers,
  parseProblemSheetAnswers,
  saveWeekAnswerSheetFile,
  syncWeekReadingQuestionsAndRegrade,
} from '@/lib/week-reading-import'

export const maxDuration = 300

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await getAuth()
    const { id: weekId } = await params
    if (!user) return err('인증이 필요합니다.', 401)

    const teacherId = await getTeacherId(supabase, user.id)
    if (!teacherId) return err('강사 정보를 찾지 못했습니다.', 404)
    if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한이 없습니다.', 403)

    const { tagList } = await fetchTeacherTagContext(supabase, teacherId)
    const matchTagId = createTagMatcher(tagList)

    const body = await request.json()
    const { fileData, mimeType, fileName } = body
    if (!fileData || !mimeType) return err('파일이 없습니다.')

    const parsedAnswers = normalizeParsedAnswers(await parseProblemSheetAnswers(fileData, mimeType))
    if (!parsedAnswers.length) {
      return err('문제지형 PDF에서 문항/정답 추출에 실패했습니다.', 422)
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
      parse_mode_used: 'problem_sheet',
      explanations_generated: false,
    })
  } catch (error) {
    console.error('[import-problem-sheet] unhandled error:', error)
    const message = error instanceof Error ? error.message : '문제지형 PDF 가져오기에 실패했습니다.'
    return err(message, 422)
  }
}
