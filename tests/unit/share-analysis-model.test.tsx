// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { useShareModel } from '@/app/share/[token]/use-share-model'
import { analysisAnswer, analysisData, analysisTag, analysisWeek } from '../fixtures/share-analysis'

afterEach(cleanup)

describe('공유 분석 모델의 입력 범위', () => {
  it('선택 기간 밖의 답은 유형 집계, 영역 표시 방식, 반복 약점에서 제외한다', () => {
    const outsideTag = { ...analysisTag, id: 'outside', name: '기간 밖 유형', category_id: 'grammar', category_name: '문법 유형' }
    const outside = analysisAnswer('outside', 'outside-week', false, [outsideTag])
    outside.exam_question!.question_style = 'subjective'
    const data = analysisData([
      analysisAnswer('a', 'w1', false), analysisAnswer('b', 'w1', false),
      analysisAnswer('c', 'w2', false), analysisAnswer('d', 'w2', false),
      outside,
      analysisAnswer('outside-2', 'outside-week-2', false, [outsideTag]),
      analysisAnswer('outside-3', 'outside-week-2', false, [outsideTag]),
      analysisAnswer('outside-4', 'outside-week', false, [outsideTag]),
    ], [analysisWeek('w1', 1), analysisWeek('w2', 2)])
    const { result } = renderHook(() => useShareModel(data))

    expect(result.current.analysisSummary.readingCount).toBe(4)
    expect(result.current.analysisSummary.wrongCount).toBe(4)
    expect(result.current.typeData.map(({ id, total }) => ({ id, total }))).toEqual([{ id: analysisTag.id, total: 4 }])
    expect(result.current.expandToDomains).toBe(true)
    expect(result.current.radarData).toEqual([{ name: '독해', rate: 0, correct: 0, total: 4 }])
    expect(result.current.repeatPatterns.map(({ id }) => id)).toEqual([analysisTag.id])
    expect(result.current.topWeakness?.id).toBe(analysisTag.id)
  })

  it('독해가 아닌 답은 분석 집계에 포함하지 않는다', () => {
    const vocab = analysisAnswer('vocab', 'w', false)
    vocab.exam_question!.exam_type = 'vocab'
    const data = analysisData([analysisAnswer('reading', 'w', true), vocab], [analysisWeek('w')])
    const { result } = renderHook(() => useShareModel(data))

    expect(result.current.analysisSummary.readingCount).toBe(1)
    expect(result.current.analysisSummary.wrongCount).toBe(0)
    expect(result.current.radarData).toEqual([{ name: '독해', rate: 100, correct: 1, total: 1 }])
    expect(result.current.repeatPatterns).toEqual([])
  })

  it('중복 태그 때문에 두 문항이 반복 약점의 네 문항 기준을 충족하지 않는다', () => {
    const repeatedTags = [analysisTag, analysisTag, analysisTag]
    const data = analysisData([
      analysisAnswer('a', 'w1', false, repeatedTags),
      analysisAnswer('b', 'w2', false, repeatedTags),
    ], [analysisWeek('w1', 1), analysisWeek('w2', 2)])
    const { result } = renderHook(() => useShareModel(data))

    expect(result.current.typeData[0]).toMatchObject({ total: 2, wrong: 2 })
    expect(result.current.radarData[0]).toMatchObject({ total: 2, correct: 0 })
    expect(result.current.repeatPatterns).toEqual([])
    expect(result.current.topWeakness).toBeNull()
    expect(data.studentAnswers[0].exam_question?.exam_question_tag).toHaveLength(3)
  })

  it('반마다 같은 주차 번호가 있어도 날짜순으로 별도 회차를 비교한다', () => {
    const earlier = { ...analysisWeek('earlier', 4, '2026-09-01'), class_id: 'class-a' }
    const later = { ...analysisWeek('later', 4, '2026-09-08'), class_id: 'class-b' }
    const data = analysisData([
      analysisAnswer('a', later.id, false), analysisAnswer('b', later.id, false),
      analysisAnswer('c', earlier.id, false), analysisAnswer('d', earlier.id, true),
    ], [later, earlier])
    const { result } = renderHook(() => useShareModel(data))

    expect(result.current.repeatPatterns).toHaveLength(1)
    expect(result.current.repeatPatterns[0]).toMatchObject({
      id: analysisTag.id, patternType: 'deteriorating', weekCount: 2,
      overallAccuracy: 25, recentAccuracy: 25, trend: -50,
      weeks: [
        { weekNumber: 1, correct: 1, total: 2, accuracy: 50 },
        { weekNumber: 2, correct: 0, total: 2, accuracy: 0 },
      ],
    })
    expect(result.current.topWeakness?.text).toBe('최근 정답률 25% · 갈수록 낮아지고 있어요')
    expect(result.current.weekNumberByWeekId.get(earlier.id)).toBe(4)
    expect(result.current.weekNumberByWeekId.get(later.id)).toBe(4)
  })
})

it('keeps nonparticipation null despite retained answers and shows an attempted zero independently of attendance',()=>{
 const week=analysisWeek('w1',1)
 const data=analysisData([analysisAnswer('a','w1',false)],[week])
 data.attendance=[{id:'absent',class_id:'class',date:'2026-04-08',status:'absent'}]
 data.weekScores=data.weekScores.map(score=>({...score,reading_correct:null}))
 const view=renderHook(({input})=>useShareModel(input),{initialProps:{input:data}})
 expect(view.result.current.weekRate(data.weekScores[0],week,'reading')).toBeNull()
 const zero={...data,weekScores:data.weekScores.map(score=>({...score,reading_correct:0}))}
 view.rerender({input:zero})
 expect(view.result.current.weekRate(zero.weekScores[0],week,'reading')).toBe(0)
})

it('shows a manually entered zero without answer rows but keeps an unattempted null empty',()=>{
 const week=analysisWeek('manual',1)
 const data=analysisData([],[week])
 const view=renderHook(({input})=>useShareModel(input),{initialProps:{input:data}})
 expect(view.result.current.weekRate(data.weekScores[0],week,'reading')).toBe(0)
 const missing={...data,weekScores:data.weekScores.map(score=>({...score,reading_correct:null}))}
 view.rerender({input:missing})
 expect(view.result.current.weekRate(missing.weekScores[0],week,'reading')).toBeNull()
})

it('excludes retained unattempted answers from every share reading model and restores actual zero without mutating originals', () => {
  const data = analysisData([analysisAnswer('retained', 'w1', false)], [analysisWeek('w1', 1)])
  data.weekScores[0].reading_correct = null
  const original = structuredClone(data)
  const view = renderHook(({input}) => useShareModel(input), {initialProps:{input:data}})
  expect(view.result.current.studentAnswers).toEqual([])
  expect(view.result.current.answersByScore.size).toBe(0)
  expect(view.result.current.wrongNoteGroups).toEqual([])
  expect(view.result.current.latestReport?.wrongReading).toBe(0)
  expect(view.result.current.latestReport?.wrongPreview).toEqual([])
  expect(view.result.current.analysisSummary.readingCount).toBe(0)
  expect(view.result.current.analysisSummary.wrongCount).toBe(0)
  expect(view.result.current.radarData).toEqual([])
  expect(view.result.current.repeatPatterns).toEqual([])
  expect(data).toEqual(original)
  const zero = {...data, weekScores: data.weekScores.map(score => ({...score, reading_correct:0}))}
  view.rerender({input:zero})
  expect(view.result.current.studentAnswers).toHaveLength(1)
  expect(view.result.current.wrongNoteGroups[0].answers).toHaveLength(1)
  expect(view.result.current.latestReport?.wrongReading).toBe(1)
  expect(view.result.current.analysisSummary.wrongCount).toBe(1)
  expect(view.result.current.periodSummary.reading?.mean).toBe(0)
  expect(data).toEqual(original)
})

it('uses each subject participation separately while preserving vocabulary study words', () => {
  const data = analysisData([analysisAnswer('retained','w1',false)], [analysisWeek('w1',1)])
  data.weeks[0].vocab_total = 1
  const word = {id:'word',week_id:'w1',number:1,english_word:'apple',correct_answer:'사과'} as import('@/app/share/[token]/share-types').VocabWord
  data.vocabWords = [word]
  data.vocabAnswers = [{id:'va',week_score_id:'score-w1',student_answer:'책',is_correct:false,vocab_word:word}] as import('@/app/share/[token]/share-types').VocabAnswer[]
  data.weekScores[0].reading_correct = null
  data.weekScores[0].vocab_correct = 0
  const view = renderHook(({input})=>useShareModel(input),{initialProps:{input:data}})
  expect(view.result.current.wrongNoteGroups).toEqual([])
  expect(view.result.current.vocabWrongGroups[0].answers).toHaveLength(1)
  const switched = {...data,weekScores:data.weekScores.map(score=>({...score,reading_correct:0,vocab_correct:null}))}
  view.rerender({input:switched})
  expect(view.result.current.wrongNoteGroups[0].answers).toHaveLength(1)
  expect(view.result.current.vocabWrongGroups).toEqual([])
  expect(view.result.current.vocabStudyItems).toHaveLength(1)
  expect(view.result.current.vocabStudyItems[0].wrongAnswer).toBeNull()
  expect(data.vocabAnswers).toHaveLength(1)
})


it('keeps an earlier attempted zero visible when the latest week is unattempted', () => {
  const data = analysisData([analysisAnswer('old','w1',false),analysisAnswer('latest','w2',false)], [analysisWeek('w1',1),analysisWeek('w2',2)])
  data.weekScores[1].reading_correct = null
  const {result} = renderHook(()=>useShareModel(data))
  expect(result.current.latestReport?.wrongReading).toBe(0)
  expect(result.current.wrongNoteGroups.map(group=>group.week.id)).toEqual(['w1'])
  expect(result.current.analysisSummary.readingCount).toBe(1)
  expect(result.current.periodSummary.reading?.mean).toBe(0)
  expect(data.studentAnswers).toHaveLength(2)
})
