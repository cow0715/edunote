import { createServiceClient } from '@/lib/supabase/server'
import { anthropic } from '@/lib/anthropic'
import { NextResponse } from 'next/server'

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const supabase = createServiceClient()
  const { token } = await params

  const { data: student } = await supabase
    .from('student').select('id').eq('share_token', token).single()
  if (!student) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const word = new URL(req.url).searchParams.get('word')
  if (!word) return NextResponse.json({ error: 'missing word' }, { status: 400 })

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    messages: [{
      role: 'user',
      content: `영어 단어 "${word}"를 사용한 자연스러운 예문 1개.
JSON만 출력: {"sentence":"영어 예문","translation":"한국어 번역"}`,
    }],
  })

  const raw = res.content[0].type === 'text' ? res.content[0].text.trim() : ''
  try {
    return NextResponse.json(JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim()))
  } catch {
    return NextResponse.json({ error: 'parse' }, { status: 500 })
  }
}
