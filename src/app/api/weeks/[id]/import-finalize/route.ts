import { assertWeekOwner, getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import type { WeekProblemSheetQuestion } from '@/lib/llm/week'
import {
  createTagMatcher,
  fetchTeacherTagContext,
  finalizeProblemSheetQuestions,
  normalizeParsedAnswers,
  problemSheetStagingPath,
  saveSourceImagesForQuestions,
  saveWeekAnswerSheetFile,
  syncWeekReadingQuestionsAndRegrade,
} from '@/lib/week-reading-import'

// 문제지형 청크 분리 가져오기 3단계: 스테이징 병합 → 전역 후처리 → DB 확정 저장 (LLM 0콜).
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
      mimeType?: string
      fileName?: string
      chunkCount?: number
      saveSourceImages?: boolean
    }
    if (!body.storagePath || !body.mimeType) return err('storagePath와 mimeType이 필요합니다.')
    if (typeof body.chunkCount !== 'number' || body.chunkCount < 1) return err('chunkCount가 필요합니다.')

    const stagingPaths = Array.from({ length: body.chunkCount }, (_, i) => problemSheetStagingPath(body.storagePath!, i))
    cleanupPaths = [body.storagePath, ...stagingPaths]

    const chunkItems = await Promise.all(stagingPaths.map(async (path, index) => {
      const { data, error } = await serviceClient.storage.from(TEMP_BUCKET).download(path)
      if (error || !data) {
        throw new Error(`청크 ${index + 1} 결과가 없습니다. 해당 청크를 다시 파싱해주세요.`)
      }
      return JSON.parse(await data.text()) as WeekProblemSheetQuestion[]
    }))

    const { tagList } = await fetchTeacherTagContext(supabase, teacherId)
    const matchTagId = createTagMatcher(tagList)

    const parsedAnswers = normalizeParsedAnswers(finalizeProblemSheetQuestions(chunkItems))
    if (!parsedAnswers.length) {
      return err('시험지 PDF에서 문항 구조 추출에 실패했습니다.', 422)
    }

    const { data: original } = await serviceClient.storage.from(TEMP_BUCKET).download(body.storagePath)
    const originalBase64 = original ? Buffer.from(await original.arrayBuffer()).toString('base64') : null
    if (originalBase64) {
      await saveWeekAnswerSheetFile(supabase, weekId, originalBase64, body.mimeType, body.fileName)
    }

    const result = await syncWeekReadingQuestionsAndRegrade({
      supabase,
      weekId,
      parsedAnswers,
      matchTagId,
      deleteMissingQuestions: false,
      regradeExistingAnswers: false,
    })

    const sourceImages = body.saveSourceImages === true && originalBase64
      ? await saveSourceImagesForQuestions(supabase, weekId, [{ fileData: originalBase64, mimeType: body.mimeType, fileName: body.fileName }])
      : { saved: 0, failed: 0 }

    return ok({
      ok: true,
      ...result,
      parse_mode_used: 'problem_sheet',
      explanations_generated: false,
      answer_key_applied: false,
      source_images_saved: sourceImages.saved,
      source_images_failed: sourceImages.failed,
    })
  } catch (error) {
    console.error('[import-finalize] unhandled error:', error)
    const message = error instanceof Error ? error.message : '문제지형 가져오기 마무리에 실패했습니다.'
    // 청크 누락 등으로 실패하면 스테이징을 지우지 않는다 — 실패 청크만 다시 파싱해 재시도할 수 있게.
    cleanupPaths = []
    return err(message, 422)
  } finally {
    if (cleanupPaths.length > 0) {
      await serviceClient.storage.from(TEMP_BUCKET).remove(cleanupPaths).catch(() => {})
    }
  }
}
