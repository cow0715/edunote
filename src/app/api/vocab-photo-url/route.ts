import { getAuth, err, ok } from '@/lib/api'
import { splitStoragePath } from '@/lib/storage-path'

// 시험지 사진 버킷들 — 임의 버킷 접근을 막기 위한 allowlist
const ALLOWED_BUCKETS = new Set(['vocab-photos', 'exam-photos'])

export async function GET(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { searchParams } = new URL(request.url)
  const path = searchParams.get('path')
  if (!path) return err('path 없음')
  const BUCKET = searchParams.get('bucket') ?? 'vocab-photos'
  if (!ALLOWED_BUCKETS.has(BUCKET)) return err('허용되지 않은 버킷')

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60) // 1시간 유효

  if (data?.signedUrl) return ok({ url: data.signedUrl })

  // 서명 실패의 대부분은 "파일이 지워짐"이다. 이건 서버 장애가 아니라
  // 정상적으로 있을 수 있는 상태라 500 이 아니라 404 로 답해야 한다.
  // (week_score.vocab_photo_path 는 남아있는데 실제 파일만 지운 경우)
  //
  // 에러 메시지 문자열로 판별하면 Supabase 쪽 문구가 바뀔 때 조용히 깨지므로,
  // 실패했을 때만 실제 존재 여부를 한 번 더 확인한다.
  const { dir, name } = splitStoragePath(path)
  const { data: matches } = await supabase.storage.from(BUCKET).list(dir, { search: name, limit: 100 })
  const exists = (matches ?? []).some((file) => file.name === name)

  if (!exists) {
    return err('원본 사진이 없습니다 (삭제되었습니다)', 404)
  }

  console.error('[vocab-photo-url] 서명 URL 생성 실패:', path, error?.message)
  return err(error?.message ?? 'URL 생성 실패', 500)
}
