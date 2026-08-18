import { describe, expect, it } from 'vitest'
import {
  buildWeekDisplayMap,
  defaultPeriodLabel,
  getPeriodForWeek,
  getWeekDisplayFallback,
  isWeekInPeriod,
  type ClassPeriod,
  type WeekForPeriod,
} from '@/lib/class-periods'

// 주차 라벨은 대시보드·주차 상세·문자 발송 화면이 공유한다.
// "Fix week detail period label", "Fix message week labels" 커밋이 여기서 났다.

function period(over: Partial<ClassPeriod> = {}): ClassPeriod {
  return {
    id: 'p1',
    class_id: 'c1',
    label: '1학기 중간',
    semester: 1,
    exam_type: 'midterm',
    start_date: '2026-03-01',
    end_date: '2026-04-30',
    is_current: false,
    sort_order: 0,
    ...over,
  }
}

function week(over: Partial<WeekForPeriod> = {}): WeekForPeriod {
  return { id: 'w1', class_id: 'c1', week_number: 1, start_date: '2026-03-02', ...over }
}

describe('defaultPeriodLabel', () => {
  it('시험 유형별 기본 라벨', () => {
    expect(defaultPeriodLabel(1, 'midterm')).toBe('1학기 중간')
    expect(defaultPeriodLabel(2, 'final')).toBe('2학기 기말')
    expect(defaultPeriodLabel(1, 'other')).toBe('1학기 기타')
  })
})

describe('getWeekDisplayFallback', () => {
  it('기간이 없을 때 쓰는 라벨', () => {
    expect(getWeekDisplayFallback(3)).toBe('3주차')
  })
})

describe('getPeriodForWeek', () => {
  it('기간 범위 안의 주차를 매칭한다', () => {
    expect(getPeriodForWeek(week(), [period()])?.id).toBe('p1')
  })

  it('주차 시작일이 없으면 매칭하지 않는다', () => {
    expect(getPeriodForWeek(week({ start_date: null }), [period()])).toBeNull()
  })

  it('다른 반의 기간과는 매칭하지 않는다', () => {
    expect(getPeriodForWeek(week({ class_id: 'c2' }), [period()])).toBeNull()
  })

  it('기간 시작 전의 주차는 매칭하지 않는다', () => {
    expect(getPeriodForWeek(week({ start_date: '2026-02-28' }), [period()])).toBeNull()
  })

  it('기간 종료 후의 주차는 매칭하지 않는다', () => {
    expect(getPeriodForWeek(week({ start_date: '2026-05-01' }), [period()])).toBeNull()
  })

  it('시작일/종료일 경계는 포함한다', () => {
    expect(getPeriodForWeek(week({ start_date: '2026-03-01' }), [period()])?.id).toBe('p1')
    expect(getPeriodForWeek(week({ start_date: '2026-04-30' }), [period()])?.id).toBe('p1')
  })

  it('종료일이 없으면(진행 중 기간) 이후 주차를 계속 매칭한다', () => {
    const ongoing = period({ id: 'open', end_date: null })
    expect(getPeriodForWeek(week({ start_date: '2027-01-01' }), [ongoing])?.id).toBe('open')
  })

  it('기간이 겹치면 나중에 시작한 기간을 고른다', () => {
    const older = period({ id: 'older', start_date: '2026-03-01', end_date: null })
    const newer = period({ id: 'newer', start_date: '2026-04-01', end_date: null })
    expect(getPeriodForWeek(week({ start_date: '2026-04-15' }), [older, newer])?.id).toBe('newer')
  })

  it('시작일이 같으면 sort_order가 큰 쪽을 고른다', () => {
    const a = period({ id: 'a', sort_order: 0 })
    const b = period({ id: 'b', sort_order: 5 })
    expect(getPeriodForWeek(week(), [a, b])?.id).toBe('b')
  })
})

describe('isWeekInPeriod', () => {
  it('범위 안이면 true', () => {
    expect(isWeekInPeriod(week(), period())).toBe(true)
  })

  it('시작일이 없으면 false', () => {
    expect(isWeekInPeriod(week({ start_date: null }), period())).toBe(false)
  })

  it('다른 반이면 false', () => {
    expect(isWeekInPeriod(week({ class_id: 'c2' }), period())).toBe(false)
  })

  it('종료일이 없으면 이후 주차도 true', () => {
    expect(isWeekInPeriod(week({ start_date: '2030-01-01' }), period({ end_date: null }))).toBe(true)
  })
})

describe('buildWeekDisplayMap', () => {
  it('기간 안에서 1주차부터 다시 번호를 매긴다', () => {
    const periods = [period({ id: 'mid', label: '1학기 중간', start_date: '2026-03-01', end_date: '2026-04-30' })]
    const weeks = [
      week({ id: 'w5', week_number: 5, start_date: '2026-03-02' }),
      week({ id: 'w6', week_number: 6, start_date: '2026-03-09' }),
      week({ id: 'w7', week_number: 7, start_date: '2026-03-16' }),
    ]
    const map = buildWeekDisplayMap(weeks, periods)

    expect(map.get('w5')).toEqual({
      displayLabel: '1학기 중간 1주차',
      periodLabel: '1학기 중간',
      periodWeekNumber: 1,
      periodId: 'mid',
    })
    expect(map.get('w7')?.displayLabel).toBe('1학기 중간 3주차')
  })

  it('입력 순서가 뒤섞여도 시작일 순으로 번호를 매긴다', () => {
    const periods = [period({ id: 'mid' })]
    const weeks = [
      week({ id: 'later', week_number: 9, start_date: '2026-03-16' }),
      week({ id: 'earlier', week_number: 8, start_date: '2026-03-02' }),
    ]
    const map = buildWeekDisplayMap(weeks, periods)
    expect(map.get('earlier')?.periodWeekNumber).toBe(1)
    expect(map.get('later')?.periodWeekNumber).toBe(2)
  })

  it('기간에 속하지 않는 주차는 N주차로 폴백한다', () => {
    const map = buildWeekDisplayMap([week({ id: 'orphan', week_number: 12, start_date: '2026-12-01' })], [period()])
    expect(map.get('orphan')).toEqual({
      displayLabel: '12주차',
      periodLabel: null,
      periodWeekNumber: null,
      periodId: null,
    })
  })

  it('시작일이 없는 주차도 폴백한다', () => {
    const map = buildWeekDisplayMap([week({ id: 'nodate', week_number: 2, start_date: null })], [period()])
    expect(map.get('nodate')?.displayLabel).toBe('2주차')
  })

  it('기간별로 번호가 독립적으로 매겨진다', () => {
    const periods = [
      period({ id: 'mid', label: '1학기 중간', start_date: '2026-03-01', end_date: '2026-04-30' }),
      period({ id: 'fin', label: '1학기 기말', start_date: '2026-05-01', end_date: '2026-06-30' }),
    ]
    const weeks = [
      week({ id: 'a', week_number: 1, start_date: '2026-03-02' }),
      week({ id: 'b', week_number: 2, start_date: '2026-03-09' }),
      week({ id: 'c', week_number: 3, start_date: '2026-05-04' }),
    ]
    const map = buildWeekDisplayMap(weeks, periods)
    expect(map.get('b')?.displayLabel).toBe('1학기 중간 2주차')
    expect(map.get('c')?.displayLabel).toBe('1학기 기말 1주차')
  })

  it('모든 주차에 대해 항목을 만든다', () => {
    const weeks = [week({ id: 'a' }), week({ id: 'b', start_date: '2026-12-01' })]
    expect(buildWeekDisplayMap(weeks, [period()]).size).toBe(2)
  })
})
