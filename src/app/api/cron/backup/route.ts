import { NextResponse } from 'next/server'

// Vercel Cron이 매일 새벽 3시(KST) = 18:00 UTC 에 호출
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: '인증 실패' }, { status: 401 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const res = await fetch(`${baseUrl}/api/backup`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  })

  const data = await res.json()
  if (!res.ok) {
    console.error('[cron/backup] 백업 실패:', data)
    return NextResponse.json({ error: data.error }, { status: 500 })
  }

  console.log('[cron/backup] 완료:', data.file)
  return NextResponse.json({ ok: true, file: data.file })
}
