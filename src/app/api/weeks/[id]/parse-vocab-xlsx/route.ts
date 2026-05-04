import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import { parseVocabWorkbookBuffer } from '@/lib/vocab-xlsx'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)

  const { fileData, fileName } = await request.json() as {
    fileData?: string
    mimeType?: string
    fileName?: string
  }

  if (!fileData) return err('파일 없음')
  if (fileName && !fileName.toLowerCase().endsWith('.xlsx')) return err('xlsx 파일만 업로드할 수 있습니다.', 400)

  try {
    const buffer = Buffer.from(fileData, 'base64')
    const words = parseVocabWorkbookBuffer(buffer)
    if (!words.length) return err('단어를 찾을 수 없습니다.', 422)
    return ok({ ok: true, words })
  } catch (error) {
    console.error('[parse-vocab-xlsx] 파싱 실패', error)
    return err(error instanceof Error ? error.message : '엑셀 파싱 실패', 422)
  }
}
