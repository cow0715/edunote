import { assertWeekOwner, getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import {
  applyWeekReadingAnswerKeyAndRegrade,
  normalizeParsedAnswers,
  type ProblemSheetUploadInput,
  parseProblemSheetAnswerKeyOnly,
} from '@/lib/week-reading-import'

export const maxDuration = 300
const TEMP_BUCKET = 'exam-pdf-temp'

type ParsedAnswerKey = Awaited<ReturnType<typeof parseProblemSheetAnswerKeyOnly>>

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

async function applyAnswerKeyWithoutRegrade(
  supabase: Awaited<ReturnType<typeof getAuth>>['supabase'],
  weekId: string,
  parsedAnswers: ParsedAnswerKey,
) {
  const { data: existingQuestions } = await supabase
    .from('exam_question')
    .select('id, question_number, sub_label')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')

  const existingMap = new Map(
    (existingQuestions ?? []).map((question) => [`${question.question_number}|${question.sub_label ?? ''}`, question.id]),
  )

  let updatedCount = 0
  for (const answer of parsedAnswers) {
    const id = existingMap.get(`${answer.question_number}|${answer.sub_label ?? ''}`)
    if (!id) continue

    const { error } = await supabase
      .from('exam_question')
      .update({
        question_style: answer.question_style,
        correct_answer: answer.correct_answer,
        correct_answer_text: answer.correct_answer_text,
      })
      .eq('id', id)

    if (error) throw new Error(`Q${answer.question_number}${answer.sub_label ?? ''}: ${error.message}`)
    updatedCount += 1
  }

  if (updatedCount === 0) {
    throw new Error('기존 문항과 매칭되는 정답이 없습니다.')
  }

  const { count } = await supabase
    .from('exam_question')
    .select('id', { count: 'exact', head: true })
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')
  await supabase.from('week').update({ reading_total: count ?? updatedCount }).eq('id', weekId)

  return { questions_parsed: updatedCount, students_regraded: 0 }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let uploadedFiles: ProblemSheetUploadInput[] = []

  try {
    const { supabase, user } = await getAuth()
    const { id: weekId } = await params
    if (!user) return err('인증이 필요합니다.', 401)

    const teacherId = await getTeacherId(supabase, user.id)
    if (!teacherId) return err('강사 정보를 찾지 못했습니다.', 404)
    if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한이 없습니다.', 403)

    const body = await request.json() as Record<string, unknown>
    uploadedFiles = normalizeFiles(body)
    const files = await resolveStorageFiles(uploadedFiles)
    if (!files.length) return err('파일이 없습니다.')

    const parsedAnswers = normalizeParsedAnswers(await parseProblemSheetAnswerKeyOnly({
      supabase,
      weekId,
      files,
    }))
    if (!parsedAnswers.length) {
      return err('정오표에서 정답을 추출하지 못했습니다.', 422)
    }

    const shouldRegrade = body.regradeExistingAnswers === true
    const result = shouldRegrade
      ? await applyWeekReadingAnswerKeyAndRegrade({
          supabase,
          weekId,
          parsedAnswers,
        })
      : await applyAnswerKeyWithoutRegrade(supabase, weekId, parsedAnswers)

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
  } finally {
    await cleanupStorageFiles(uploadedFiles)
  }
}
