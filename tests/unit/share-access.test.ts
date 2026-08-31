import { describe, expect, it } from 'vitest'
import { canViewShare, isRotationDue, resolveShareToken, type ShareEnrollment } from '@/lib/share-access'

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

// ── 토큰 해석 (회전 + 유예) ─────────────────────────────────────────────────
//
// 쿼리 빌더를 흉내 내는 최소 스텁. resolveShareToken 이 부르는 체인은
// .from().select().eq()[.gt()].maybeSingle() 뿐이라 이 정도면 분기를 전부 태울 수 있다.
type StubRow = Record<string, unknown> | null

function stubClient(handler: (filters: Record<string, string>) => StubRow) {
  const make = (filters: Record<string, string>) => ({
    select: () => make(filters),
    eq: (col: string, val: string) => make({ ...filters, [col]: val }),
    gt: (col: string, val: string) => make({ ...filters, [`${col}__gt`]: val }),
    maybeSingle: async () => ({ data: handler(filters) }),
  })
  return { from: () => make({}) } as unknown as Parameters<typeof resolveShareToken>[0]
}

const CURRENT = '11111111-1111-1111-1111-111111111111'
const PREVIOUS = '22222222-2222-2222-2222-222222222222'

describe('resolveShareToken — 회전과 유예', () => {
  it('현재 토큰이면 바로 통과한다', async () => {
    const client = stubClient((f) => (f.share_token === CURRENT ? { id: 's1' } : null))
    const r = await resolveShareToken<{ id: string }>(client, CURRENT, 'id')
    expect(r).toEqual({ status: 'ok', student: { id: 's1' }, viaPreviousToken: false })
  })

  it('유예가 남은 직전 토큰도 통과시키되 viaPreviousToken 으로 표시한다', async () => {
    const client = stubClient((f) =>
      f.previous_share_token === PREVIOUS && f.previous_share_token_expires_at__gt ? { id: 's1' } : null
    )
    const r = await resolveShareToken<{ id: string }>(client, PREVIOUS, 'id')
    expect(r).toEqual({ status: 'ok', student: { id: 's1' }, viaPreviousToken: true })
  })

  it('유예가 끝난 직전 토큰은 만료로 구분한다 (404 아님)', async () => {
    // 만료 필터가 붙은 조회는 비고, 필터 없는 조회에서만 잡히는 상황
    const client = stubClient((f) =>
      f.previous_share_token === PREVIOUS && !f.previous_share_token_expires_at__gt ? { id: 's1' } : null
    )
    expect(await resolveShareToken(client, PREVIOUS, 'id')).toEqual({ status: 'expired' })
  })

  it('아무 데도 없는 토큰은 not_found', async () => {
    const client = stubClient(() => null)
    expect(await resolveShareToken(client, 'garbage', 'id')).toEqual({ status: 'not_found' })
  })

  it('현재 토큰이 우선이다 — 옛 토큰 조회로 새지 않는다', async () => {
    // 두 컬럼 모두 매칭되는 극단적인 경우에도 현재 토큰 결과를 쓴다
    const client = stubClient((f) => (f.share_token ? { id: 'current' } : { id: 'previous' }))
    const r = await resolveShareToken<{ id: string }>(client, CURRENT, 'id')
    expect(r).toMatchObject({ student: { id: 'current' }, viaPreviousToken: false })
  })
})

// ── 회전일 판정 ─────────────────────────────────────────────────────────────
//
// cron 은 매일 돌고 실제 회전 여부는 이 함수가 정한다 (Vercel Hobby 의 하루 1회 제한 때문).
// KST 기준이라 UTC 로 전날 15:00 부터가 "1일" 이다.
describe('isRotationDue — 분기 첫날(KST)에만 돈다', () => {
  const at = (iso: string) => isRotationDue(new Date(iso))

  it('3·6·9·12월 1일이면 돈다', () => {
    for (const m of ['03', '06', '09', '12']) {
      expect(at(`2026-${m}-01T00:00:00Z`)).toBe(true)
    }
  })

  it('회전 달이어도 1일이 아니면 안 돈다', () => {
    expect(at('2026-03-02T00:00:00Z')).toBe(false)
    expect(at('2026-06-15T00:00:00Z')).toBe(false)
    expect(at('2026-12-31T00:00:00Z')).toBe(false)
  })

  it('회전 달이 아니면 1일이어도 안 돈다', () => {
    expect(at('2026-01-01T00:00:00Z')).toBe(false)
    expect(at('2026-07-01T00:00:00Z')).toBe(false)
  })

  it('UTC 가 아니라 KST 로 판정한다 — 2월 28일 15:00 UTC 는 이미 3월 1일', () => {
    expect(at('2026-02-28T15:00:00Z')).toBe(true)   // KST 3/1 00:00
    expect(at('2026-02-28T14:59:00Z')).toBe(false)  // KST 2/28 23:59
  })

  it('KST 로 날이 넘어가면 더는 회전일이 아니다', () => {
    expect(at('2026-03-01T14:59:00Z')).toBe(true)   // KST 3/1 23:59
    expect(at('2026-03-01T15:00:00Z')).toBe(false)  // KST 3/2 00:00
  })

  it('cron 실행 시각(19:00 UTC)에 회전일로 잡히는 날은 KST 로 다음 날 새벽 4시다', () => {
    // vercel.json 은 매일 19:00 UTC 에 부른다 = KST 04:00.
    // 즉 KST 3/1 04:00 에 도는 셈이고, 그 시각의 UTC 는 2/28 19:00 이다.
    expect(at('2026-02-28T19:00:00Z')).toBe(true)
  })
})
