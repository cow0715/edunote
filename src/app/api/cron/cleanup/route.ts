import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { EXAM_PHOTO_BUCKET, pruneOldVocabPhotos } from '@/lib/vocab-photo-retention'
import { checkExamIntegrity } from '@/lib/exam-integrity'

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

  // 진단평가 답안지 사진도 같은 30일 보존 정책
  const examPrune = await pruneOldVocabPhotos(supabase, { bucket: EXAM_PHOTO_BUCKET })
  if (examPrune.error) {
    console.error('[cron/cleanup] 답안지 사진 정리 실패:', examPrune.error)
    return NextResponse.json({ ok: false, error: examPrune.error, deleted: photoPrune.deleted.length + examPrune.deleted.length }, { status: 500 })
  }

  console.log(`[cron/cleanup] 단어 사진 ${photoPrune.deleted.length}개 + 답안지 사진 ${examPrune.deleted.length}개 삭제 (전체 ${photoPrune.scanned + examPrune.scanned}개 중)`)

  // 시험 데이터 정합성 점검 — 논리적으로 불가능한 상태를 매일 세어 남긴다.
  // 지금까지 나온 결함들은 전부 몇 달 뒤 손으로 뒤져서 발견됐다. 여기서 그날 드러나게 한다.
  // 사진 정리와 무관하므로 실패해도 cleanup 은 성공으로 끝낸다.
  const integrity = await checkExamIntegrity(supabase)
  if (!integrity.ok) {
    console.warn('[cron/cleanup] 정합성 점검 건너뜀:', integrity.error)
  } else if (integrity.summary.hasIssue) {
    console.error(`[cron/cleanup] 정합성 이상 ${integrity.summary.total}건 (점수 영향 ${integrity.summary.scoreAffecting}건)`)
    integrity.summary.lines.forEach((line) => console.error(`  ${line}`))
    console.error('  상세: select * from exam_integrity_issue;')
  } else {
    console.log('[cron/cleanup] 정합성 점검 이상 없음')
  }

  return NextResponse.json({
    ok: true,
    deleted: photoPrune.deleted.length + examPrune.deleted.length,
    scanned: photoPrune.scanned + examPrune.scanned,
    integrity: integrity.ok
      ? { total: integrity.summary.total, scoreAffecting: integrity.summary.scoreAffecting }
      : { error: integrity.error },
  })
}
