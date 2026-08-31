import { createServiceClient } from '@/lib/supabase/server'
import { callClaudeText, MODELS, parseJsonObjectResponse } from '@/lib/llm/client'
import { SHARE_CLOSED_ERROR, SHARE_EXPIRED_ERROR, canViewShareByStudentId, resolveShareToken } from '@/lib/share-access'
import { NextResponse } from 'next/server'


export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const supabase = createServiceClient()
  const { token } = await params

  const found = await resolveShareToken<{ id: string }>(supabase, token, 'id')
  if (found.status === 'expired') return NextResponse.json({ error: SHARE_EXPIRED_ERROR }, { status: 410 })
  if (found.status !== 'ok') return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const student = found.student
  if (!await canViewShareByStudentId(supabase, student.id)) {
    return NextResponse.json({ error: SHARE_CLOSED_ERROR }, { status: 403 })
  }

  const word = new URL(req.url).searchParams.get('word')
  if (!word) return NextResponse.json({ error: 'missing word' }, { status: 400 })

  const raw = await callClaudeText({
    model: MODELS.light,
    maxTokens: 150,
    content: `영어 단어 "${word}"를 사용한 자연스러운 예문 1개.
JSON만 출력: {"sentence":"영어 예문","translation":"한국어 번역"}`,
  })

  try {
    return NextResponse.json(parseJsonObjectResponse<{ sentence: string; translation: string }>(raw, 'vocab-hint'))
  } catch {
    return NextResponse.json({ error: 'parse' }, { status: 500 })
  }
}
