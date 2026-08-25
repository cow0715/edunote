import { assertWeekOwner, getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import {
  fetchAnswerKeyQuestionContext,
  parseAnswerKeyChunkForStaging,
  problemSheetStagingPath,
} from '@/lib/week-reading-import'

// 정오표 청크 분리 가져오기 2단계: 청크 1개 파싱 → 스테이징 JSON 저장.
// 병합("같은 번호는 뒤가 이긴다")과 문항 수 검증은 answer-key-finalize 몫.
// 같은 청크 재요청은 스테이징을 덮어쓰므로 멱등하다.
export const maxDuration = 300
const TEMP_BUCKET = 'exam-pdf-temp'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
      chunkIndex?: number
      startPage?: number
      endPage?: number
    }
    if (!body.storagePath || !body.mimeType) return err('storagePath와 mimeType이 필요합니다.')
    if (typeof body.chunkIndex !== 'number' || typeof body.startPage !== 'number' || typeof body.endPage !== 'number') {
      return err('chunkIndex/startPage/endPage가 필요합니다.')
    }

    const serviceClient = createServiceClient()
    const { data, error } = await serviceClient.storage.from(TEMP_BUCKET).download(body.storagePath)
    if (error || !data) return err(`파일 다운로드 실패: ${error?.message ?? body.storagePath}`)
    const fileData = Buffer.from(await data.arrayBuffer()).toString('base64')

    const { questions } = await fetchAnswerKeyQuestionContext(supabase, weekId)
    const items = await parseAnswerKeyChunkForStaging({
      fileData,
      mimeType: body.mimeType,
      range: { startPage: body.startPage, endPage: body.endPage },
      questions,
    })

    const stagingPath = problemSheetStagingPath(body.storagePath, body.chunkIndex)
    const { error: uploadError } = await serviceClient.storage
      .from(TEMP_BUCKET)
      .upload(stagingPath, JSON.stringify(items), { contentType: 'application/json', upsert: true })
    if (uploadError) return err(`청크 결과 저장 실패: ${uploadError.message}`, 500)

    return ok({ answer_count: items.length })
  } catch (error) {
    console.error('[answer-key-chunk] unhandled error:', error)
    return err(error instanceof Error ? error.message : '정오표 청크 파싱에 실패했습니다.', 422)
  }
}
