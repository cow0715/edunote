import { assertWeekOwner, getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import { planAnswerKeyChunks, planProblemSheetChunks } from '@/lib/week-reading-import'

// 청크 분리 가져오기 1단계: 청크 경계 계산 (LLM 0콜).
// mode 'problem_sheet'(기본): 문항 경계 정렬 3~5p → import-chunk / import-finalize
// mode 'answer_key': 3p 단순 분할 → answer-key-chunk / answer-key-finalize
export const maxDuration = 60
const TEMP_BUCKET = 'exam-pdf-temp'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await getAuth()
    const { id: weekId } = await params
    if (!user) return err('인증이 필요합니다.', 401)

    const teacherId = await getTeacherId(supabase, user.id)
    if (!teacherId) return err('강사 정보를 찾지 못했습니다.', 404)
    if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한이 없습니다.', 403)

    const body = await request.json() as { storagePath?: string; mimeType?: string; mode?: string }
    if (!body.storagePath || !body.mimeType) return err('storagePath와 mimeType이 필요합니다.')

    const serviceClient = createServiceClient()
    const { data, error } = await serviceClient.storage.from(TEMP_BUCKET).download(body.storagePath)
    if (error || !data) return err(`파일 다운로드 실패: ${error?.message ?? body.storagePath}`)

    const fileData = Buffer.from(await data.arrayBuffer()).toString('base64')
    const chunks = body.mode === 'answer_key'
      ? await planAnswerKeyChunks(fileData, body.mimeType)
      : await planProblemSheetChunks(fileData, body.mimeType)

    return ok({ chunks })
  } catch (error) {
    console.error('[import-plan] unhandled error:', error)
    return err(error instanceof Error ? error.message : '청크 계획 수립에 실패했습니다.', 422)
  }
}
