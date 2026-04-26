import { assertWeekOwner, getAuth, getTeacherId, err, ok } from '@/lib/api'
import {
  applyWeekReadingAnswerKeyAndRegrade,
  normalizeParsedAnswers,
  type ProblemSheetUploadInput,
  parseProblemSheetAnswerKeyOnly,
} from '@/lib/week-reading-import'

export const maxDuration = 300

function normalizeFiles(body: Record<string, unknown>): ProblemSheetUploadInput[] {
  if (Array.isArray(body.files)) {
    return body.files
      .filter((file): file is ProblemSheetUploadInput => {
        if (!file || typeof file !== 'object') return false
        const candidate = file as Record<string, unknown>
        return typeof candidate.fileData === 'string' && typeof candidate.mimeType === 'string'
      })
      .map((file) => ({
        fileData: file.fileData,
        mimeType: file.mimeType,
        fileName: file.fileName,
      }))
  }

  if (typeof body.fileData === 'string' && typeof body.mimeType === 'string') {
    return [{
      fileData: body.fileData,
      mimeType: body.mimeType,
      fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
    }]
  }

  return []
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await getAuth()
    const { id: weekId } = await params
    if (!user) return err('인증이 필요합니다.', 401)

    const teacherId = await getTeacherId(supabase, user.id)
    if (!teacherId) return err('강사 정보를 찾지 못했습니다.', 404)
    if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한이 없습니다.', 403)

    const body = await request.json() as Record<string, unknown>
    const files = normalizeFiles(body)
    if (!files.length) return err('파일이 없습니다.')

    const parsedAnswers = normalizeParsedAnswers(await parseProblemSheetAnswerKeyOnly({
      supabase,
      weekId,
      files,
    }))
    if (!parsedAnswers.length) {
      return err('정오표에서 정답을 추출하지 못했습니다.', 422)
    }

    const result = await applyWeekReadingAnswerKeyAndRegrade({
      supabase,
      weekId,
      parsedAnswers,
    })

    return ok({
      ok: true,
      ...result,
      parse_mode_used: 'problem_answer_key',
      explanations_generated: false,
      answer_key_applied: true,
    })
  } catch (error) {
    console.error('[import-problem-answer-key] unhandled error:', error)
    const message = error instanceof Error ? error.message : '정오표 가져오기에 실패했습니다.'
    return err(message, 422)
  }
}
