// ── 단어 시험지 사진 보관 기간 ─────────────────────────────────────────────
// vocab-photos 버킷의 {weekId}/{studentId}.jpg 는 강사가 정오표에서 "원본 사진"으로 OCR 오독을 확인하는 용도.
// 채점 후 한 달이면 충분하므로 30일(VOCAB_PHOTO_RETENTION_DAYS) 지난 파일을 매일 정리 cron(/api/cron/cleanup) 에서 지운다.
// 지워지면 정오표의 "원본 사진" 버튼은 404 → 그냥 안 뜸 (vocab-photo-url 이 이미 처리).

import type { SupabaseClient } from '@supabase/supabase-js'

export const VOCAB_PHOTO_BUCKET = 'vocab-photos'
export const DEFAULT_VOCAB_PHOTO_RETENTION_DAYS = 30

export function resolvePhotoRetentionDays(raw: string | undefined = process.env.VOCAB_PHOTO_RETENTION_DAYS): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_VOCAB_PHOTO_RETENTION_DAYS
  return Math.floor(parsed)
}

export type StorageObjectLike = { name: string; created_at?: string | null; updated_at?: string | null }

/**
 * 보관 기간이 지난 파일 경로를 고른다 (순수 함수, 테스트 대상).
 * 기준 시각은 updated_at (재채점하면 갱신되므로) → 없으면 created_at. 둘 다 없으면 지우지 않는다.
 */
export function selectExpiredPhotoPaths(
  objects: Array<StorageObjectLike & { prefix: string }>,
  now: Date,
  retentionDays: number,
): string[] {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000
  return objects
    .filter((o) => {
      const stamp = o.updated_at ?? o.created_at
      if (!stamp) return false
      const t = new Date(stamp).getTime()
      return Number.isFinite(t) && t < cutoff
    })
    .map((o) => `${o.prefix}/${o.name}`)
}

/**
 * vocab-photos 버킷을 훑어 보관 기간 지난 사진을 삭제한다.
 * 버킷 구조가 {weekId}/{file} 2단이라 최상위 폴더 목록 → 각 폴더 파일 목록 순으로 본다.
 * 실패해도 호출부(cron)에 영향 주지 않도록 에러는 문자열로 돌려준다.
 */
export async function pruneOldVocabPhotos(
  supabase: SupabaseClient,
  opts: { now?: Date; retentionDays?: number } = {},
): Promise<{ deleted: string[]; scanned: number; error?: string }> {
  const now = opts.now ?? new Date()
  const retentionDays = opts.retentionDays ?? resolvePhotoRetentionDays()
  const storage = supabase.storage.from(VOCAB_PHOTO_BUCKET)

  const { data: folders, error: folderErr } = await storage.list('', { limit: 1000 })
  if (folderErr) return { deleted: [], scanned: 0, error: folderErr.message }

  const candidates: Array<StorageObjectLike & { prefix: string }> = []
  for (const folder of folders ?? []) {
    // 폴더는 id 가 null 로 온다 (파일은 id 있음). 최상위에 파일이 직접 있으면 prefix '' 로 취급
    if (folder.id) {
      candidates.push({ prefix: '', name: folder.name, created_at: folder.created_at, updated_at: folder.updated_at })
      continue
    }
    const { data: files, error: fileErr } = await storage.list(folder.name, { limit: 1000 })
    if (fileErr) return { deleted: [], scanned: candidates.length, error: `${folder.name}: ${fileErr.message}` }
    for (const f of files ?? []) {
      if (!f.id) continue // 하위 폴더는 없다고 가정
      candidates.push({ prefix: folder.name, name: f.name, created_at: f.created_at, updated_at: f.updated_at })
    }
  }

  const expired = selectExpiredPhotoPaths(candidates, now, retentionDays)
    .map((p) => (p.startsWith('/') ? p.slice(1) : p))
  if (expired.length === 0) return { deleted: [], scanned: candidates.length }

  const CHUNK = 100
  const deleted: string[] = []
  for (let i = 0; i < expired.length; i += CHUNK) {
    const batch = expired.slice(i, i + CHUNK)
    const { error } = await storage.remove(batch)
    if (error) return { deleted, scanned: candidates.length, error: error.message }
    deleted.push(...batch)
  }
  return { deleted, scanned: candidates.length }
}
