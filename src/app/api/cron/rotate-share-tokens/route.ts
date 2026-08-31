import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ROTATION_GRACE_DAYS, isRotationDue } from '@/lib/share-access'

// 학부모 공유 링크를 분기마다(3·6·9·12월 1일 KST) 새로 발급한다.
//
// vercel.json 에는 "매일" 로 걸고 회전일 판정은 isRotationDue 가 한다.
// Vercel Hobby 는 하루 1회 스케줄만 허용해서 cron 표현식에 분기를 못 적기 때문이다.
// 회전일이 아니면 DB 를 건드리지 않고 바로 돌아간다.
//
// 옛 토큰은 ROTATION_GRACE_DAYS 동안 계속 열린다.
// 유예가 남은 학생은 SQL 함수가 건너뛰므로 두 번 불려도 방금 발급한 링크가 죽지 않는다.
//
// force=1 은 손으로 즉시 돌릴 때만. 유예가 안 끝난 학생은 그래도 건너뛴다.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: '인증 실패' }, { status: 401 })
  }

  const force = new URL(request.url).searchParams.get('force') === '1'
  if (!force && !isRotationDue(new Date())) {
    return NextResponse.json({ ok: true, skipped: true, reason: '회전일이 아닙니다' })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('rotate_share_tokens', { grace_days: ROTATION_GRACE_DAYS })

  if (error) {
    console.error('[cron/rotate-share-tokens] 회전 실패:', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const rotated = typeof data === 'number' ? data : 0
  console.log(`[cron/rotate-share-tokens] ${rotated}명 재발급`)
  return NextResponse.json({ ok: true, rotated })
}
