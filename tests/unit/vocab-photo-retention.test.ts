import { describe, expect, it } from 'vitest'
import { resolvePhotoRetentionDays, selectExpiredPhotoPaths, DEFAULT_VOCAB_PHOTO_RETENTION_DAYS } from '@/lib/vocab-photo-retention'

const NOW = new Date('2026-08-18T00:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()

describe('resolvePhotoRetentionDays', () => {
  it('기본 30일', () => {
    expect(resolvePhotoRetentionDays(undefined)).toBe(DEFAULT_VOCAB_PHOTO_RETENTION_DAYS)
    expect(DEFAULT_VOCAB_PHOTO_RETENTION_DAYS).toBe(30)
  })
  it('환경변수 파싱, 잘못된 값은 기본으로', () => {
    expect(resolvePhotoRetentionDays('14')).toBe(14)
    expect(resolvePhotoRetentionDays('7.9')).toBe(7)
    expect(resolvePhotoRetentionDays('0')).toBe(30)
    expect(resolvePhotoRetentionDays('abc')).toBe(30)
  })
})

describe('selectExpiredPhotoPaths', () => {
  it('보관 기간 지난 파일만 고른다', () => {
    const paths = selectExpiredPhotoPaths([
      { prefix: 'week-a', name: 's1.jpg', updated_at: daysAgo(31) },
      { prefix: 'week-a', name: 's2.jpg', updated_at: daysAgo(29) },
      { prefix: 'week-b', name: 's3.jpg', updated_at: daysAgo(90) },
    ], NOW, 30)
    expect(paths).toEqual(['week-a/s1.jpg', 'week-b/s3.jpg'])
  })

  it('updated_at 우선, 없으면 created_at', () => {
    const paths = selectExpiredPhotoPaths([
      { prefix: 'w', name: 'recent-update.jpg', created_at: daysAgo(60), updated_at: daysAgo(5) },
      { prefix: 'w', name: 'old-created.jpg', created_at: daysAgo(60), updated_at: null },
    ], NOW, 30)
    expect(paths).toEqual(['w/old-created.jpg'])
  })

  it('타임스탬프 없으면 지우지 않는다', () => {
    expect(selectExpiredPhotoPaths([{ prefix: 'w', name: 'x.jpg' }], NOW, 30)).toEqual([])
    expect(selectExpiredPhotoPaths([{ prefix: 'w', name: 'x.jpg', updated_at: 'garbage' }], NOW, 30)).toEqual([])
  })

  it('경계: 정확히 30일 전은 지우지 않는다 (cutoff 미만만)', () => {
    expect(selectExpiredPhotoPaths([{ prefix: 'w', name: 'x.jpg', updated_at: daysAgo(30) }], NOW, 30)).toEqual([])
    expect(selectExpiredPhotoPaths([{ prefix: 'w', name: 'x.jpg', updated_at: daysAgo(30.01) }], NOW, 30)).toEqual(['w/x.jpg'])
  })
})
