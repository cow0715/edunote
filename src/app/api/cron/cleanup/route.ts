import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { pruneOldVocabPhotos } from '@/lib/vocab-photo-retention'

// Vercel Cron 이 매일 새벽 3시(KST) = 18:00 UTC 에 호출.
// 단어 시험지 사진처럼 보관 기간이 지난 Storage 객체를 정리한다.
// (DB 백업/복원은 앱 레벨이 아니라 DB 단 표준 백업으로 별도 운영 예정)
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: '인증 실패' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // 단어 시험지 사진 정리 (기본 30일, VOCAB_PHOTO_RETENTION_DAYS)
  // 폰 사진 원본이 학생당 3~6MB 씩 쌓여 Storage 를 채웠다. 업로드 압축(1/15)과 함께 용량 대책.
  const photoPrune = await pruneOldVocabPhotos(supabase)
  if (photoPrune.error) {
    console.error('[cron/cleanup] 단어 사진 정리 실패:', photoPrune.error)
    return NextResponse.json({ ok: false, error: photoPrune.error, deleted: photoPrune.deleted.length }, { status: 500 })
  }

  console.log(`[cron/cleanup] 단어 사진 ${photoPrune.deleted.length}개 삭제 (전체 ${photoPrune.scanned}개 중)`)
  return NextResponse.json({ ok: true, deleted: photoPrune.deleted.length, scanned: photoPrune.scanned })
}
