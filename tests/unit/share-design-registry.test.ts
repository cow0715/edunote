import { describe, expect, it } from 'vitest'
import { getShareDesign, parseShareInput, SHARE_DESIGNS, shareDesignFrameUrl } from '@/components/dev/share-design-registry'
import { getShareDesignSample, SAMPLE_PERIODS, SAMPLE_SCENARIOS } from '@/components/dev/share-design-samples'
import { buildShareAnalysis } from '@/lib/share-analysis'

describe('개발자 도구의 share 디자인 선택과 링크 입력', () => {
  it('저장된 디자인을 고르고 모르는 값은 최신 보완 중심 디자인으로 복구한다', () => {
    for (const design of SHARE_DESIGNS) expect(getShareDesign(design.id)).toBe(design)
    for (const missing of [undefined, null, '', 'removed-design']) expect(getShareDesign(missing).id).toBe('latest')
    expect(new Set(SHARE_DESIGNS.map((design) => design.id)).size).toBe(SHARE_DESIGNS.length)
  })

  it('토큰만 입력하거나 정상 공유 경로를 입력할 수 있다', () => {
    expect(parseShareInput('  parent_token-123  ')).toEqual({ token: 'parent_token-123', periodId: null })
    expect(parseShareInput('/share/parent_token-123')).toEqual({ token: 'parent_token-123', periodId: null })
    expect(parseShareInput('https://edunote.example/share/parent_token-123/')).toEqual({ token: 'parent_token-123', periodId: null })
  })

  it('공유 링크의 선택 기간을 보존하고 다른 쿼리는 사용하지 않는다', () => {
    expect(parseShareInput('/share/parent-token?periodId=period-september&theme=dark#analysis')).toEqual({ token: 'parent-token', periodId: 'period-september' })
    expect(parseShareInput('/share/parent-token?periodId=%EA%B8%B0%EA%B0%84%20%26%201')).toEqual({ token: 'parent-token', periodId: '기간 & 1' })
  })

  it('외부 주소에서는 share 경로와 기간만 추출하고 미리보기 출처는 현재 앱에 고정한다', () => {
    const input = parseShareInput('https://external.example:8443/share/parent-token?periodId=fall')!
    expect(input).toEqual({ token: 'parent-token', periodId: 'fall' })
    const frame = shareDesignFrameUrl({ design: 'latest', scenario: 'default', theme: 'light', ...input })
    const url = new URL(frame, 'https://current-app.example')
    expect(url.origin).toBe('https://current-app.example')
    expect(url.pathname).toBe('/dev/share-design/frame')
    expect(url.searchParams.get('token')).toBe('parent-token')
    expect(url.searchParams.get('periodId')).toBe('fall')
  })

  it.each([
    '', '   ', 'javascript:alert(1)', 'data:text/html,<h1>share</h1>', 'file:///share/token',
    '/retake/token', '/share/token/retake', '/share/token/nested', '/share/',
    'https://external.example/other/token', '/share/token%2Fnested', 'a'.repeat(129),
  ])('공유 화면이 아닌 입력을 거절한다: %s', (input) => {
    expect(parseShareInput(input)).toBeNull()
  })

  it('시안 프레임은 모든 디자인에서 내부 경로를 사용하고 학습 상황을 쿼리로 전달한다', () => {
    for (const design of SHARE_DESIGNS) {
      const frame = shareDesignFrameUrl({ design: design.id, scenario: 'recovery', theme: 'dark', periodId: 'semester' })
      const url = new URL(frame, 'https://current-app.example')
      expect(url.pathname).toBe('/dev/share-design/frame')
      expect(url.origin).toBe('https://current-app.example')
      expect(Object.fromEntries(url.searchParams)).toEqual({ design: design.id, theme: 'dark', scenario: 'recovery', periodId: 'semester' })
    }
  })

  it('실제 링크를 쓸 때 가상 상황을 제거하고 쿼리 값이 추가 파라미터나 경로가 되지 않게 인코딩한다', () => {
    const url = new URL(shareDesignFrameUrl({ design: 'trend', scenario: 'default', theme: 'light', token: 'token&design=list/#', periodId: '기간 & token=other/?' }), 'https://current-app.example')
    expect(url.pathname).toBe('/dev/share-design/frame')
    expect(url.searchParams.get('design')).toBe('trend')
    expect(url.searchParams.get('token')).toBe('token&design=list/#')
    expect(url.searchParams.get('periodId')).toBe('기간 & token=other/?')
    expect(url.searchParams.has('scenario')).toBe(false)
    expect(url.hash).toBe('')
    expect([...url.searchParams.keys()]).toHaveLength(4)
  })

  it('가상 상황 이름도 인코딩하고 기간을 지정하지 않았으면 기간 파라미터를 추가하지 않는다', () => {
    const url = new URL(shareDesignFrameUrl({ design: 'list', scenario: 'default&token=injected', theme: 'light' }), 'https://current-app.example')
    expect(url.searchParams.get('scenario')).toBe('default&token=injected')
    expect(url.searchParams.has('token')).toBe(false)
    expect(url.searchParams.has('periodId')).toBe(false)
  })
})

describe('share 디자인의 전체 화면용 기록 정합성', () => {
  const combinations = SAMPLE_PERIODS.flatMap((period) => SAMPLE_SCENARIOS.map((scenario) => ({ period, scenario })))

  it.each(combinations)('$period.label · $scenario.label에서 성적과 공개된 오답·단어 수가 일치한다', ({ period, scenario }) => {
    const data = getShareDesignSample(period.id, scenario.id)
    expect(data.student).toMatchObject({ name: '김민준', grade: '고2' })
    expect(data.currentPeriod?.id).toBe(period.id)
    expect(data.weeks).toHaveLength(scenario.id === 'short' ? Math.min(2, period.weekCount) : period.weekCount)
    for (const week of data.weeks) {
      const score = data.weekScores.find((item) => item.week_id === week.id)!
      const reading = data.studentAnswers.filter((answer) => answer.week_score_id === score.id)
      const vocabWrong = data.vocabAnswers.filter((answer) => answer.week_score_id === score.id)
      expect(week.start_date! >= period.startDate && week.start_date! <= period.endDate).toBe(true)
      expect(reading).toHaveLength(week.reading_total)
      expect(reading.filter((answer) => answer.is_correct)).toHaveLength(score.reading_correct)
      expect(vocabWrong).toHaveLength(week.vocab_total - score.vocab_correct!)
      expect(vocabWrong.every((answer) => !answer.is_correct)).toBe(true)
      expect(data.vocabWords.filter((word) => word.week_id === week.id)).toHaveLength(week.vocab_total)
      expect(data.attendance.some((item) => item.date === week.start_date && item.class_id === week.class_id)).toBe(true)
      expect(score.memo).toBeTruthy()
      for (const answer of reading) {
        const question = answer.exam_question!
        expect(question.week_id).toBe(week.id)
        expect(question.choices).toHaveLength(5)
        expect(question.passage).toBeTruthy()
        expect(question.explanation).toBeTruthy()
        expect(question.question_stem).toBeTruthy()
        expect(question.correct_answer).toBeGreaterThanOrEqual(1)
        expect(question.correct_answer).toBeLessThanOrEqual(5)
        expect(answer.student_answer === question.correct_answer).toBe(answer.is_correct)
      }
      for (const word of data.vocabWords.filter((item) => item.week_id === week.id)) {
        expect(word.correct_answer).toBeTruthy()
        expect(word.example_sentence).toBeTruthy()
        expect(word.example_translation).toBeTruthy()
      }
    }
  })

  it('기본 기록은 충분한 보완·복습·안정 유형을 함께 제공한다', () => {
    const data = getShareDesignSample()
    const result = buildShareAnalysis(data.studentAnswers, data.weeks)
    expect(result.types).toHaveLength(8)
    expect(result.types.filter((type) => type.status === 'priority')).toHaveLength(2)
    expect(result.types.filter((type) => type.status === 'review')).toHaveLength(2)
    expect(result.types.filter((type) => type.status === 'stable')).toHaveLength(4)
    expect(data.clinicAttendance.length).toBeGreaterThan(0)
    expect(data.attendance.some((record) => record.status === 'absent')).toBe(true)
    expect(data.attendance.some((record) => record.status === 'late')).toBe(true)
  })

  it('짧은 기록과 10월 2회 기록은 유형별 약점 판단을 보류한다', () => {
    for (const data of [getShareDesignSample('semester', 'short'), getShareDesignSample('october', 'default')]) {
      const result = buildShareAnalysis(data.studentAnswers, data.weeks)
      expect(result.types.every((type) => type.status === 'insufficient')).toBe(true)
      expect(result.types.every((type) => !type.trendComparable && type.change === null)).toBe(true)
      expect(result.wrongCount).toBeGreaterThan(0)
    }
  })

  it('최근 오답 증가 사례는 누적 안정과 최근 확인을 구분할 충분한 문항을 제공한다', () => {
    const data = getShareDesignSample('semester', 'decline')
    const result = buildShareAnalysis(data.studentAnswers, data.weeks)
    const blank = result.types.find((type) => type.id === 'share-design-blank')!
    expect(blank).toMatchObject({ status: 'stable', recentStatus: 'priority', trendComparable: true, cumulative: { correct: 52, total: 60, rate: 87 }, recent: { correct: 4, total: 12, rate: 33 }, previous: { correct: 24, total: 24, rate: 100 } })
    expect(result.priorities.some((type) => type.id === blank.id)).toBe(true)
  })

  it('최근 회복 사례는 누적 약점 기록을 남기면서 현재 적극 추천에서 제외한다', () => {
    const data = getShareDesignSample('semester', 'recovery')
    const result = buildShareAnalysis(data.studentAnswers, data.weeks)
    const blank = result.types.find((type) => type.id === 'share-design-blank')!
    expect(blank).toMatchObject({ status: 'priority', recentStatus: 'stable', trendComparable: true, cumulative: { correct: 24, total: 48, rate: 50 }, recent: { correct: 16, total: 16, rate: 100 }, previous: { correct: 4, total: 16, rate: 25 } })
    expect(result.priorities.some((type) => type.id === blank.id)).toBe(false)
    expect(data.studentAnswers.some((answer) => !answer.is_correct && answer.exam_question?.exam_question_tag.some(({ concept_tag }) => concept_tag?.id === blank.id))).toBe(true)
  })

  it('모두 정답 사례는 독해·단어 오답이 없고 복습 추천을 만들지 않는다', () => {
    const data = getShareDesignSample('semester', 'perfect')
    const result = buildShareAnalysis(data.studentAnswers, data.weeks)
    expect(result.wrongCount).toBe(0)
    expect(result.priorities).toEqual([])
    expect(data.vocabAnswers).toEqual([])
    expect(data.studentAnswers.every((answer) => answer.is_correct)).toBe(true)
  })

  it('기간을 바꿔도 같은 상황의 공통 회차는 같은 답과 식별자를 유지한다', () => {
    const full = getShareDesignSample('semester', 'default')
    const september = getShareDesignSample('september', 'default')
    for (const week of september.weeks) {
      expect(full.weeks.some((item) => item.id === week.id)).toBe(true)
      expect(september.studentAnswers.filter((answer) => answer.exam_question?.week_id === week.id)).toEqual(full.studentAnswers.filter((answer) => answer.exam_question?.week_id === week.id))
    }
    expect(getShareDesignSample('unknown-period', 'unknown-scenario')).toEqual(full)
  })
})
