import { assertWeekOwner, getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import {
  type ProblemSheetUploadInput,
  createTagMatcher,
  fetchTeacherTagContext,
  normalizeParsedAnswers,
  parseProblemSheetQuestionsOnly,
  saveWeekAnswerSheetFile,
  syncWeekReadingQuestionsAndRegrade,
} from '@/lib/week-reading-import'

export const maxDuration = 300
const TEMP_BUCKET = 'exam-pdf-temp'

function normalizeFiles(body: Record<string, unknown>): ProblemSheetUploadInput[] {
  if (Array.isArray(body.files)) {
    return body.files
      .filter((file): file is ProblemSheetUploadInput => {
        if (!file || typeof file !== 'object') return false
        const candidate = file as Record<string, unknown>
        return (
          typeof candidate.mimeType === 'string' &&
          (typeof candidate.fileData === 'string' || typeof candidate.storagePath === 'string')
        )
      })
      .map((file) => ({
        fileData: file.fileData,
        storagePath: file.storagePath,
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

async function resolveStorageFiles(files: ProblemSheetUploadInput[]): Promise<ProblemSheetUploadInput[]> {
  const serviceClient = createServiceClient()

  return Promise.all(files.map(async (file) => {
    if (file.fileData) return file
    if (!file.storagePath) throw new Error('스토리지 경로가 없습니다.')

    const { data, error } = await serviceClient.storage.from(TEMP_BUCKET).download(file.storagePath)
    if (error || !data) throw new Error(`파일 다운로드 실패: ${error?.message ?? file.storagePath}`)

    const buffer = await data.arrayBuffer()
    return {
      ...file,
      fileData: Buffer.from(buffer).toString('base64'),
    }
  }))
}

async function cleanupStorageFiles(files: ProblemSheetUploadInput[]) {
  const paths = files.map((file) => file.storagePath).filter((path): path is string => !!path)
  if (paths.length === 0) return

  const serviceClient = createServiceClient()
  await serviceClient.storage.from(TEMP_BUCKET).remove(paths).catch(() => {})
}

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

    const body = await request.json() as Record<string, unknown>
    const uploadedFiles = normalizeFiles(body)
    const files = await resolveStorageFiles(uploadedFiles)
    if (!files.length) return err('파일이 없습니다.')

    const parsedAnswers = normalizeParsedAnswers(await parseProblemSheetQuestionsOnly(files))
    if (!parsedAnswers.length) {
      return err('시험지 PDF에서 문항 구조 추출에 실패했습니다.', 422)
    }

    if (files.length === 1) {
      const [first] = files
      if (first.fileData) {
        await saveWeekAnswerSheetFile(supabase, weekId, first.fileData, first.mimeType, first.fileName)
      }
    }
    const result = await syncWeekReadingQuestionsAndRegrade({
      supabase,
      weekId,
      parsedAnswers,
      matchTagId,
    })

    const response = ok({
      ok: true,
      ...result,
      parse_mode_used: 'problem_sheet',
      explanations_generated: false,
      answer_key_applied: false,
    })
    await cleanupStorageFiles(uploadedFiles)
    return response
  } catch (error) {
    console.error('[import-problem-sheet] unhandled error:', error)
    const message = error instanceof Error ? error.message : '문제지형 PDF 가져오기에 실패했습니다.'
    return err(message, 422)
  }
}
