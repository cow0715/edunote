import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { parseVocabPdf } from '@/lib/anthropic'

export const maxDuration = 60

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: weekId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { fileData, mimeType } = await request.json()
  if (!fileData || !mimeType) return NextResponse.json({ error: '파일 없음' }, { status: 400 })

  // 기존 등록된 단어 수 확인 (weekId용)
  void weekId

  try {
    const words = await parseVocabPdf(fileData, mimeType)
    if (!words.length) return NextResponse.json({ error: '단어를 찾을 수 없습니다' }, { status: 422 })
    return NextResponse.json({ ok: true, words })
  } catch (e) {
    console.error('[parse-vocab-pdf] 파싱 실패', e)
    return NextResponse.json({ error: '단어 파싱 실패. 파일을 확인해주세요.' }, { status: 422 })
  }
}
