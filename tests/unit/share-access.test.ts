import { describe, expect, it } from 'vitest'
import { canViewShare, type ShareEnrollment } from '@/lib/share-access'

const enrollment = (over: Partial<ShareEnrollment> = {}): ShareEnrollment => ({
  class_id: 'c1', joined_at: '2026-03-01', left_at: null, ...over,
})

describe('canViewShare — 퇴원 즉시 차단', () => {
  it('활성 등록이 있고 반이 살아있으면 열어준다', () => {
    expect(canViewShare([enrollment()], ['c1'])).toBe(true)
  })

  it('등록 이력이 아예 없으면 막는다', () => {
    expect(canViewShare([], ['c1'])).toBe(false)
  })

  it('모든 등록에 left_at 이 찍혔으면 막는다 (퇴원)', () => {
    const rows = [
      enrollment({ class_id: 'c1', left_at: '2026-06-30' }),
      enrollment({ class_id: 'c2', left_at: '2026-07-31' }),
    ]
    expect(canViewShare(rows, ['c1', 'c2'])).toBe(false)
  })

  it('활성 등록이 있어도 그 반이 보관됐으면 막는다', () => {
    expect(canViewShare([enrollment({ class_id: 'c1' })], [])).toBe(false)
  })

  it('정규반은 다니고 특강반만 나갔으면 계속 열어준다', () => {
    const rows = [
      enrollment({ class_id: 'regular', left_at: null }),
      enrollment({ class_id: 'special', left_at: '2026-08-20' }),
    ]
    expect(canViewShare(rows, ['regular', 'special'])).toBe(true)
  })

  it('나간 반만 살아있고 다니는 반이 보관됐으면 막는다', () => {
    const rows = [
      enrollment({ class_id: 'archived', left_at: null }),
      enrollment({ class_id: 'open', left_at: '2026-08-20' }),
    ]
    expect(canViewShare(rows, ['open'])).toBe(false)
  })

  it('class_id 가 비었으면 그 행은 세지 않는다', () => {
    expect(canViewShare([enrollment({ class_id: '' })], [''])).toBe(false)
  })

  it('퇴원 처리 한 번으로 바로 닫힌다', () => {
    const rows = [enrollment({ class_id: 'c1' })]
    expect(canViewShare(rows, ['c1'])).toBe(true)
    const afterWithdraw = [enrollment({ class_id: 'c1', left_at: '2026-08-28' })]
    expect(canViewShare(afterWithdraw, ['c1'])).toBe(false)
  })
})
