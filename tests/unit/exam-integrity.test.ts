import { describe, expect, it } from 'vitest'
import { INTEGRITY_SEVERITY, summarizeIntegrity, type IntegrityCount } from '@/lib/exam-integrity'

const rows = (...pairs: [string, number][]): IntegrityCount[] =>
  pairs.map(([kind, count]) => ({ kind, count }))

describe('summarizeIntegrity', () => {
  it('이상이 없으면 hasIssue 가 false 다', () => {
    const s = summarizeIntegrity(rows(['조합선택형_오분리', 0], ['소문항_단독', 0]))
    expect(s).toMatchObject({ total: 0, scoreAffecting: 0, hasIssue: false, lines: [] })
  })

  it('0 건인 항목은 세지도 적지도 않는다', () => {
    const s = summarizeIntegrity(rows(['미작성_정답처리', 3], ['소문항_단독', 0]))
    expect(s.total).toBe(3)
    expect(s.lines).toHaveLength(1)
  })

  it('점수에 영향 가는 항목만 scoreAffecting 에 센다', () => {
    const s = summarizeIntegrity(rows(
      ['미작성_정답처리', 22],          // score
      ['objective_판정_불일치', 7],     // score
      ['소문항_단독', 4],               // data
      ['objective_정답텍스트_혼입', 6], // data
    ))
    expect(s.total).toBe(39)
    expect(s.scoreAffecting).toBe(29)
  })

  it('점수 영향 항목을 데이터 항목보다 먼저 적는다', () => {
    const s = summarizeIntegrity(rows(['소문항_단독', 99], ['미작성_정답처리', 1]))
    expect(s.lines[0]).toContain('[점수]')
    expect(s.lines[0]).toContain('미작성_정답처리')
    expect(s.lines[1]).toContain('[데이터]')
  })

  it('같은 성격끼리는 건수가 많은 것부터 적는다', () => {
    const s = summarizeIntegrity(rows(['미작성_정답처리', 2], ['중복답안', 10]))
    expect(s.lines[0]).toContain('중복답안: 10건')
    expect(s.lines[1]).toContain('미작성_정답처리: 2건')
  })

  it('모르는 kind 가 와도 죽지 않고 데이터 항목으로 취급한다', () => {
    // 뷰에 점검 항목을 새로 추가하고 앱을 아직 배포 안 한 상황
    const s = summarizeIntegrity(rows(['새로운_점검항목', 5]))
    expect(s.total).toBe(5)
    expect(s.scoreAffecting).toBe(0)
    expect(s.lines[0]).toContain('[데이터]')
  })

  it('뷰의 모든 kind 가 심각도 표에 등록돼 있다', () => {
    // 뷰에 항목을 늘리면 여기도 같이 늘려야 한다는 걸 잊지 않게
    expect(Object.keys(INTEGRITY_SEVERITY).sort()).toEqual([
      'objective_정답키_없음',
      'objective_정답텍스트_혼입',
      'objective_판정_불일치',
      'ox_판정_불일치',
      '점수합_불일치',
      '조합선택형_오분리',
      '중복답안',
      '미작성_정답처리',
      '소문항_단독',
      '소문항_지문_없음',
    ].sort())
  })
})
