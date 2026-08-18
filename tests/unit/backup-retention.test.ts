import { describe, expect, it } from 'vitest'
import {
  BACKUP_FILE_PATTERN,
  DEFAULT_BACKUP_RETENTION,
  isListingTrustworthy,
  resolveRetentionCount,
  selectExpiredBackups,
} from '@/lib/backup-retention'

// 이 판단이 틀리면 백업을 통째로 날린다. 경계를 전부 박아둔다.

function backupsFor(days: number): string[] {
  return Array.from({ length: days }, (_, index) => {
    const day = String(index + 1).padStart(2, '0')
    return `backup_2026-08-${day}_1800.json`
  })
}

describe('BACKUP_FILE_PATTERN', () => {
  it('cron 이 만드는 이름만 인식한다', () => {
    expect(BACKUP_FILE_PATTERN.test('backup_2026-08-07_1800.json')).toBe(true)
  })

  it('형식이 다르면 인식하지 않는다', () => {
    for (const name of [
      'backup_2026-08-07.json',        // 시각 없음
      'backup_2026-8-7_1800.json',     // 0 패딩 없음
      'backup_2026-08-07_1800.txt',    // 확장자 다름
      'manual_export.json',
      'backup_2026-08-07_1800.json.bak',
    ]) {
      expect(BACKUP_FILE_PATTERN.test(name), name).toBe(false)
    }
  })
})

describe('selectExpiredBackups', () => {
  it('보관 개수보다 적으면 아무것도 지우지 않는다', () => {
    expect(selectExpiredBackups(backupsFor(5), 14)).toEqual([])
  })

  it('보관 개수와 정확히 같으면 지우지 않는다', () => {
    expect(selectExpiredBackups(backupsFor(14), 14)).toEqual([])
  })

  it('넘치는 만큼만 오래된 것부터 지운다', () => {
    const expired = selectExpiredBackups(backupsFor(20), 14)
    expect(expired).toHaveLength(6)
    // 가장 오래된 6개(1~6일)가 대상
    expect(expired.sort()).toEqual([
      'backup_2026-08-01_1800.json',
      'backup_2026-08-02_1800.json',
      'backup_2026-08-03_1800.json',
      'backup_2026-08-04_1800.json',
      'backup_2026-08-05_1800.json',
      'backup_2026-08-06_1800.json',
    ])
  })

  it('최신 파일은 절대 대상에 들어가지 않는다', () => {
    const expired = selectExpiredBackups(backupsFor(20), 14)
    expect(expired).not.toContain('backup_2026-08-20_1800.json')
    expect(expired).not.toContain('backup_2026-08-07_1800.json')
  })

  it('입력 순서가 뒤섞여도 시간순으로 판단한다', () => {
    const shuffled = ['backup_2026-08-03_1800.json', 'backup_2026-08-01_1800.json', 'backup_2026-08-02_1800.json']
    expect(selectExpiredBackups(shuffled, 2)).toEqual(['backup_2026-08-01_1800.json'])
  })

  it('같은 날 여러 번 백업해도 시각까지 보고 판단한다', () => {
    const sameDay = [
      'backup_2026-08-07_0300.json',
      'backup_2026-08-07_1800.json',
      'backup_2026-08-07_1200.json',
    ]
    expect(selectExpiredBackups(sameDay, 1)).toEqual([
      'backup_2026-08-07_1200.json',
      'backup_2026-08-07_0300.json',
    ])
  })

  // ── 안전장치 ──────────────────────────────────────────────────────────────

  it('cron 형식이 아닌 파일은 절대 지우지 않는다', () => {
    const mixed = [...backupsFor(20), 'manual_export.json', '중요자료.json', 'backup_old.json']
    const expired = selectExpiredBackups(mixed, 1)
    expect(expired.every((name) => BACKUP_FILE_PATTERN.test(name))).toBe(true)
    expect(expired).not.toContain('manual_export.json')
    expect(expired).not.toContain('중요자료.json')
    expect(expired).not.toContain('backup_old.json')
  })

  it('keep 이 0 이하여도 최소 1개는 남긴다 (전부 삭제 방지)', () => {
    expect(selectExpiredBackups(backupsFor(3), 0)).toHaveLength(2)
    expect(selectExpiredBackups(backupsFor(3), -5)).toHaveLength(2)
  })

  it('빈 목록이면 빈 결과', () => {
    expect(selectExpiredBackups([], 14)).toEqual([])
  })

  it('원본 배열을 변형하지 않는다', () => {
    const input = backupsFor(20)
    const snapshot = [...input]
    selectExpiredBackups(input, 14)
    expect(input).toEqual(snapshot)
  })
})

describe('isListingTrustworthy', () => {
  // storage.list() 는 호스트에 연결 못 해도 빈 배열 + error:null 을 준다.
  // 방금 올린 파일이 목록에 있는지로 조회가 진짜였는지 판별한다.
  it('방금 올린 파일이 목록에 있으면 신뢰한다', () => {
    expect(isListingTrustworthy(backupsFor(3), 'backup_2026-08-02_1800.json')).toBe(true)
  })

  it('방금 올린 파일이 없으면 신뢰하지 않는다', () => {
    expect(isListingTrustworthy(backupsFor(3), 'backup_2026-08-09_1800.json')).toBe(false)
  })

  it('접속 실패로 빈 목록이 오면 신뢰하지 않는다', () => {
    expect(isListingTrustworthy([], 'backup_2026-08-07_1800.json')).toBe(false)
  })

  it('기준 파일이 없으면(수동 실행 등) 검사를 건너뛴다', () => {
    expect(isListingTrustworthy([], undefined)).toBe(true)
  })
})

describe('resolveRetentionCount', () => {
  it('설정이 없으면 기본값', () => {
    expect(resolveRetentionCount(undefined)).toBe(DEFAULT_BACKUP_RETENTION)
    expect(resolveRetentionCount('')).toBe(DEFAULT_BACKUP_RETENTION)
  })

  it('숫자를 그대로 쓴다', () => {
    expect(resolveRetentionCount('7')).toBe(7)
    expect(resolveRetentionCount('30')).toBe(30)
  })

  it('이상한 값이면 기본값으로 되돌린다', () => {
    expect(resolveRetentionCount('abc')).toBe(DEFAULT_BACKUP_RETENTION)
    expect(resolveRetentionCount('0')).toBe(DEFAULT_BACKUP_RETENTION)
    expect(resolveRetentionCount('-3')).toBe(DEFAULT_BACKUP_RETENTION)
  })

  it('소수는 내림한다', () => {
    expect(resolveRetentionCount('7.9')).toBe(7)
  })
})
