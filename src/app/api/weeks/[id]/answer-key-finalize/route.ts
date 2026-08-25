import { assertWeekOwner, getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import type { ProblemSheetAnswerKeyItem } from '@/lib/llm/week'
import {
  applyAnswerKeyWithoutRegrade,
  applyWeekReadingAnswerKeyAndRegrade,
  fetchAnswerKeyQuestionContext,
  finalizeAnswerKeyItems,
  normalizeParsedAnswers,
  problemSheetStagingPath,
} from '@/lib/week-reading-import'

// 정오표 청크 분리 가져오기 3단계: 스테이징 병합("뒤가 이긴다") → 검증 → 정답 반영(+선택 재채점).
// AI 해설 생성은 여기서 하지 않는다 — explanations-drain 을 클라이언트가 반복 호출.
// 항상 전체 스테이징을 다시 계산하므로 재실행해도 결과가 같다 (멱등).
export const maxDuration = 300
const TEMP_BUCKET = 'exam-pdf-temp'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let cleanupPaths: string[] = []
  const serviceClient = createServiceClient()

  try {
    const { supabase, user } = await getAuth()
    const { id: weekId } = await params
    if (!user) return err('인증이 필요합니다.', 401)

    const teacherId = await getTeacherId(supabase, user.id)
    if (!teacherId) return err('강사 정보를 찾지 못했습니다.', 404)
    if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한이 없습니다.', 403)

    const body = await request.json() as {
      storagePath?: string
      chunkCount?: number
      regradeExistingAnswers?: boolean
    }
    if (!body.storagePath) return err('storagePath가 필요합니다.')
    if (typeof body.chunkCount !== 'number' || body.chunkCount < 1) return err('chunkCount가 필요합니다.')

    const stagingPaths = Array.from({ length: body.chunkCount }, (_, i) => problemSheetStagingPath(body.storagePath!, i))
    cleanupPaths = [body.storagePath, ...stagingPaths]

    const keyItems = (await Promise.all(stagingPaths.map(async (path, index) => {
      const { data, error } = await serviceClient.storage.from(TEMP_BUCKET).download(path)
      if (error || !data) {
        throw new Error(`정오표 청크 ${index + 1} 결과가 없습니다. 해당 청크를 다시 파싱해주세요.`)
      }
      return JSON.parse(await data.text()) as ProblemSheetAnswerKeyItem[]
    }))).flat()

    const context = await fetchAnswerKeyQuestionContext(supabase, weekId)
    const parsedAnswers = normalizeParsedAnswers(finalizeAnswerKeyItems(keyItems, context))
    if (!parsedAnswers.length) {
      return err('정오표에서 정답을 추출하지 못했습니다.', 422)
    }

    const result = body.regradeExistingAnswers === true
      ? await applyWeekReadingAnswerKeyAndRegrade({ supabase, weekId, parsedAnswers })
      : await applyAnswerKeyWithoutRegrade(supabase, weekId, parsedAnswers)

    return ok({
      ok: true,
      ...result,
      parse_mode_used: 'problem_answer_key',
      answer_key_applied: true,
    })
  } catch (error) {
    console.error('[answer-key-finalize] unhandled error:', error)
    const message = error instanceof Error ? error.message : '정오표 가져오기 마무리에 실패했습니다.'
    // 실패 시 스테이징 보존 — 실패 청크만 다시 파싱해 재시도할 수 있게.
    cleanupPaths = []
    return err(message, 422)
  } finally {
    if (cleanupPaths.length > 0) {
      await serviceClient.storage.from(TEMP_BUCKET).remove(cleanupPaths).catch(() => {})
    }
  }
}
