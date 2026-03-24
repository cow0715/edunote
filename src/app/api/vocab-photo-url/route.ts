import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const path = searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'path 없음' }, { status: 400 })

  const { data, error } = await supabase.storage
    .from('vocab-photos')
    .createSignedUrl(path, 60 * 60) // 1시간 유효

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message ?? 'URL 생성 실패' }, { status: 500 })
  }

  return NextResponse.json({ url: data.signedUrl })
}
