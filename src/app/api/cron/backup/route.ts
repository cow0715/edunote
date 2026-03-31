import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Vercel Cron이 매일 새벽 3시(KST) = 18:00 UTC 에 호출
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: '인증 실패' }, { status: 401 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  let data: Record<string, unknown>
  try {
    const res = await fetch(`${baseUrl}/api/backup`, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    })
    data = await res.json()

    if (!res.ok) {
      throw new Error(data.error as string ?? `HTTP ${res.status}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[cron/backup] 백업 실패:', msg)
    // /api/backup까지 도달하지 못한 경우 cron 레벨에서 직접 로그
    const supabase = createServiceClient()
    await supabase.from('backup_log').insert({
      triggered_by: 'cron',
      status: 'error',
      error_msg: `cron fetch 실패: ${msg}`,
    })
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  console.log('[cron/backup] 완료:', data.file)
  return NextResponse.json({ ok: true, file: data.file })
}
