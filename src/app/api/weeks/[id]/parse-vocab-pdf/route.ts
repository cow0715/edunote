import { getAuth, err, ok } from '@/lib/api'
import { parseVocabPdf } from '@/lib/anthropic'

export const maxDuration = 60

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

  const { fileData, mimeType } = await request.json()
  if (!fileData || !mimeType) return err('파일 없음')

  // 기존 등록된 단어 수 확인 (weekId용)
  void weekId

  try {
    const words = await parseVocabPdf(fileData, mimeType)
    if (!words.length) return err('단어를 찾을 수 없습니다', 422)
    return ok({ ok: true, words })
  } catch (e) {
    console.error('[parse-vocab-pdf] 파싱 실패', e)
    return err('단어 파싱 실패. 파일을 확인해주세요.', 422)
  }
}
