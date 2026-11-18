import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import { parseVocabWorkbookBuffer, VocabWorkbookFormatError } from '@/lib/vocab-xlsx'
import { normalizeVocabEntries } from '@/lib/vocab-variants'
import { reportOperationalFailure } from '@/lib/report-operational-failure'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)

  const { fileData, fileName } = await request.json().catch(() => null) ?? {}

  if (typeof fileData !== 'string' || !fileData.trim()) return err('파일 없음')
  if (fileName && (typeof fileName !== 'string' || !fileName.toLowerCase().endsWith('.xlsx'))) return err('xlsx 파일만 업로드할 수 있습니다.', 400)

  try {
    const buffer = Buffer.from(fileData, 'base64')
    if (!buffer.length) return err('파일 없음')
    const words = parseVocabWorkbookBuffer(buffer)
    if (!words.length) return err('단어를 찾을 수 없습니다.', 422)
    const normalizedWords = await normalizeVocabEntries(words, { useAi: false })
    return ok({ ok: true, words: normalizedWords })
  } catch (error) {
    console.error('[parse-vocab-xlsx] 파싱 실패', error)
    if (!(error instanceof VocabWorkbookFormatError)) reportOperationalFailure('vocab-upload', 'xlsx-parse')
    return err(error instanceof Error ? error.message : '엑셀 파싱 실패', 422)
  }
}
