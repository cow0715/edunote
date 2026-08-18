/**
 * 백업 파일 보관 정책.
 *
 * cron 이 매일 전체 테이블 덤프를 `backup` 버킷에 올리는데 지우는 쪽이 없어서
 * 무한정 쌓였다 (Supabase Storage 용량 초과의 원인). 여기서 오래된 것을 정리한다.
 *
 * 외부 S3 이중 업로드(lib/s3-backup.ts)가 켜져 있으면 장기 보관은 그쪽이 맡고,
 * Supabase 쪽은 최근 것만 들고 있으면 된다.
 *
 * "무엇을 지울지" 판단은 selectExpiredBackups 순수 함수로 분리했다 —
 * 이 판단이 틀리면 백업을 통째로 날릴 수 있어서 테스트로 못 박는다.
 */

import type { createServiceClient } from '@/lib/supabase/server'

export const BACKUP_BUCKET = 'backup'
export const DEFAULT_BACKUP_RETENTION = 14

/** cron 이 만드는 파일명만 대상으로 삼는다. 수동으로 올린 다른 파일은 절대 건드리지 않는다. */
export const BACKUP_FILE_PATTERN = /^backup_\d{4}-\d{2}-\d{2}_\d{4}\.json$/

export function resolveRetentionCount(raw: string | undefined = process.env.BACKUP_RETENTION_COUNT): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_BACKUP_RETENTION
  return Math.floor(parsed)
}

/**
 * 최신 keep 개를 남기고 삭제할 파일명을 고른다.
 *
 * 파일명이 `backup_YYYY-MM-DD_HHMM.json` 이라 사전순 정렬 = 시간순 정렬이다.
 * 안전장치 두 가지:
 *   - 패턴에 맞지 않는 파일은 후보에서 제외 (남의 파일 삭제 방지)
 *   - keep 은 최소 1 — 전부 지우는 경우가 생기지 않게
 */
export function selectExpiredBackups(fileNames: string[], keep: number): string[] {
  const safeKeep = Math.max(1, Math.floor(keep))
  return fileNames
    .filter((name) => BACKUP_FILE_PATTERN.test(name))
    .sort()
    .reverse() // 최신이 앞
    .slice(safeKeep)
}

type ServiceClient = ReturnType<typeof createServiceClient>

/** 버킷의 파일 목록 전체. list 는 한 번에 최대 100개라 페이지네이션이 필요하다. */
export async function listAllBackupFiles(supabase: ServiceClient): Promise<string[]> {
  const PAGE = 100
  const names: string[] = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase.storage
      .from(BACKUP_BUCKET)
      .list('', { limit: PAGE, offset, sortBy: { column: 'name', order: 'desc' } })

    if (error) throw new Error(`백업 목록 조회 실패: ${error.message}`)
    if (!data || data.length === 0) break

    names.push(...data.map((file) => file.name))
    if (data.length < PAGE) break
    offset += data.length
  }

  return names
}

export type PruneResult = {
  kept: number
  deleted: string[]
  error?: string
}

/**
 * 목록이 믿을 만한지 검사한다.
 *
 * supabase-js 의 storage.list() 는 **호스트에 연결조차 못 해도**
 * `{ data: [], error: null }` 을 돌려준다 (직접 확인함).
 * 그래서 "빈 버킷"과 "접속 실패"를 구분할 수 없다.
 *
 * 다행히 정리는 업로드 직후에 돈다. 방금 올린 파일이 목록에 없으면
 * 목록이 불완전하다는 뜻이므로 삭제를 건너뛴다.
 */
export function isListingTrustworthy(fileNames: string[], justUploaded: string | undefined): boolean {
  if (!justUploaded) return true
  return fileNames.includes(justUploaded)
}

/**
 * 오래된 백업을 실제로 지운다.
 *
 * 백업 자체보다 중요하지 않으므로 실패해도 예외를 던지지 않는다 —
 * 정리에 실패했다고 백업이 실패로 기록되면 안 된다.
 *
 * @param justUploaded 방금 올린 파일명. 목록 신뢰성 검사에 쓴다.
 */
export async function pruneOldBackups(
  supabase: ServiceClient,
  options: { keep?: number; justUploaded?: string } = {},
): Promise<PruneResult> {
  const keep = options.keep ?? resolveRetentionCount()
  try {
    const all = await listAllBackupFiles(supabase)

    if (!isListingTrustworthy(all, options.justUploaded)) {
      return {
        kept: 0,
        deleted: [],
        error: `목록에 방금 올린 ${options.justUploaded} 이 없습니다. 조회가 불완전하므로 정리를 건너뜁니다.`,
      }
    }

    const expired = selectExpiredBackups(all, keep)
    const kept = all.filter((name) => BACKUP_FILE_PATTERN.test(name)).length - expired.length

    if (expired.length === 0) return { kept, deleted: [] }

    // remove 도 한 번에 너무 많이 보내지 않는다
    const CHUNK = 100
    for (let i = 0; i < expired.length; i += CHUNK) {
      const { error } = await supabase.storage.from(BACKUP_BUCKET).remove(expired.slice(i, i + CHUNK))
      if (error) return { kept, deleted: expired.slice(0, i), error: error.message }
    }

    return { kept, deleted: expired }
  } catch (e) {
    return { kept: 0, deleted: [], error: e instanceof Error ? e.message : String(e) }
  }
}
