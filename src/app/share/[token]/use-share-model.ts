'use client'

// share 화면의 파생 데이터 계산을 한곳에 모은 훅.
// 탭 컴포넌트들은 이 결과만 받아 그리기만 한다 (계산 로직을 탭마다 복제하지 않는다).

import { useMemo } from 'react'
import { classifyPatterns } from '@/hooks/weakness/useAnalysis'
import { compareExamDomain, describeRadarAxis, resolveExamDomain, shouldExpandToDomains } from '@/lib/exam-domain'
import { TrendItem } from '@/components/share/score-trend-chart'
import { HomeworkItem } from '@/components/share/homework-bar-chart'
import { RadarItem } from '@/components/share/concept-radar-chart'
import { ShareData, StudentAnswer, VocabAnswer, VocabWord, Week, WeekScore } from './share-types'
import {
  EMPTY_AVERAGES,
  EMPTY_LIST,
  ScoreField,
  VocabStudyItem,
  WeeklyMetric,
  avg,
  buildWeeklyHeadline,
  buildWeeklyNotes,
  fmtWeekLabel,
  getWeekLabel,
  isComparableTotal,
} from './share-utils'

/** 홈 "이번 주 오답" 미리보기 한 줄 */
export type WrongPreviewItem = { kind: 'reading' | 'vocab'; label: string; detail: string | null }

/** 홈 탭 "이번 주" 카드 한 장에 필요한 것 전부 */
export type WeeklyReport = {
  week: Week
  className: string
  reading: WeeklyMetric | null
  vocab: WeeklyMetric | null
  homework: WeeklyMetric | null
  wrongReading: number
  wrongVocab: number
  memo: string | null
  headline: string
  notes: { good: string[]; watch: string[] }
  wrongPreview: WrongPreviewItem[]
}

/** 최근 N주 한 지표의 흐름 */
export type TrendStat = { rates: number[]; mean: number | null; classDiff: number | null }

export function useShareModel(data: ShareData | undefined) {
  const classes = data?.classes ?? EMPTY_LIST
  const periodOptions = data?.periodOptions ?? EMPTY_LIST
  const weeks = data?.weeks ?? EMPTY_LIST
  const weekScores = data?.weekScores ?? EMPTY_LIST
  const studentAnswers = data?.studentAnswers ?? EMPTY_LIST
  const vocabAnswers = data?.vocabAnswers ?? EMPTY_LIST
  const vocabWords = data?.vocabWords ?? EMPTY_LIST
  const attendance = data?.attendance ?? EMPTY_LIST
  const clinicAttendance = data?.clinicAttendance ?? EMPTY_LIST
  const classAverages = data?.classAverages ?? EMPTY_AVERAGES

  const periodGroups = useMemo(() => periodOptions.reduce((groups, period) => {
    const key = period.class_name || '지난 기록'
    const list = groups.get(key) ?? []
    list.push(period)
    groups.set(key, list)
    return groups
  }, new Map<string, typeof periodOptions>()), [periodOptions])

  // ── 점수 모델: 주차/점수 색인 + 정답률 계산기 ────────────────────────────
  const scoreModel = useMemo(() => {
    const scoreByWeek = new Map(weekScores.map((s) => [s.week_id, s]))
    const answersByScore = new Map<string, StudentAnswer[]>()
    studentAnswers.forEach((a) => {
      const list = answersByScore.get(a.week_score_id) ?? []
      list.push(a)
      answersByScore.set(a.week_score_id, list)
    })
    const weekNumberByWeekId = new Map(weeks.map((w) => [w.id, w.week_number]))
    const weekLabelByWeekId = new Map(weeks.map((w) => [w.id, w.display_label ?? `${w.week_number}주차`]))

    const scoredWeeks = weeks.filter((w) => scoreByWeek.has(w.id)).sort((a, b) => a.week_number - b.week_number)
    const visibleWeeks = [...scoredWeeks].reverse()

    const hasReadingData = (weekId: string, scoreId: string) => {
      const s = scoreByWeek.get(weekId)!
      return (answersByScore.get(scoreId)?.some((a) => a.exam_question?.exam_type === 'reading') ?? false) || s.reading_correct > 0
    }
    const weekRate = (score: WeekScore, week: Week, field: ScoreField): number | null => {
      if (field === 'reading') return week.reading_total > 0 && score.reading_correct !== null && hasReadingData(week.id, score.id) ? Math.round(score.reading_correct / week.reading_total * 100) : null
      if (field === 'vocab') return week.vocab_total > 0 && score.vocab_correct !== null ? Math.round(score.vocab_correct / week.vocab_total * 100) : null
      if (field === 'homework') return week.homework_total > 0 && score.homework_done !== null ? Math.round(score.homework_done / week.homework_total * 100) : null
      return null
    }

    const readingRates = scoredWeeks.map((w) => weekRate(scoreByWeek.get(w.id)!, w, 'reading')).filter((v): v is number => v !== null)
    const vocabRates = scoredWeeks.map((w) => weekRate(scoreByWeek.get(w.id)!, w, 'vocab')).filter((v): v is number => v !== null)
    const homeworkRates = scoredWeeks.map((w) => weekRate(scoreByWeek.get(w.id)!, w, 'homework')).filter((v): v is number => v !== null)

    const [latestW, prevW] = [visibleWeeks[0], visibleWeeks[1]]
    const latestS = latestW ? scoreByWeek.get(latestW.id) : undefined
    const prevS = prevW ? scoreByWeek.get(prevW.id) : undefined
    const delta = (field: ScoreField) => {
      const l = latestW && latestS ? weekRate(latestS, latestW, field) : null
      const p = prevW && prevS ? weekRate(prevS, prevW, field) : null
      return l !== null && p !== null ? l - p : null
    }
    const deltas = { reading: delta('reading'), vocab: delta('vocab'), homework: delta('homework') }
    const latestRates = latestW && latestS
      ? { reading: weekRate(latestS, latestW, 'reading'), vocab: weekRate(latestS, latestW, 'vocab'), homework: weekRate(latestS, latestW, 'homework') }
      : { reading: null, vocab: null, homework: null }

    return {
      scoreByWeek, answersByScore, weekNumberByWeekId, weekLabelByWeekId,
      scoredWeeks, visibleWeeks, weekRate,
      readingRates, vocabRates, homeworkRates,
      latestW, latestS, prevW, deltas, latestRates,
    }
  }, [weeks, weekScores, studentAnswers])

  const {
    scoreByWeek, answersByScore, weekNumberByWeekId, scoredWeeks, visibleWeeks, weekRate, deltas,
  } = scoreModel

  // ── 출결 통계 ─────────────────────────────────────────────────────────────
  const attendanceStats = useMemo(() => {
    const totalAtt = attendance.length
    const presentAtt = attendance.filter((a) => a.status !== 'absent').length
    const attRate = totalAtt > 0 ? Math.round(presentAtt / totalAtt * 100) : null
    const totalClinicAtt = clinicAttendance.length
    const presentClinicAtt = clinicAttendance.filter((a) => a.status !== 'absent').length
    const clinicAttRate = totalClinicAtt > 0 ? Math.round(presentClinicAtt / totalClinicAtt * 100) : null
    const attByDate = new Map(attendance.map((a) => [a.date, a]))
    // 최근부터 결석 없이 이어진 회수 — "N회 연속 출석" 은 학부모 리포트의 관습적 칭찬거리다
    let attendanceStreak = 0
    for (const a of [...attendance].sort((x, y) => y.date.localeCompare(x.date))) {
      if (a.status === 'absent') break
      attendanceStreak++
    }
    return { totalAtt, presentAtt, attRate, totalClinicAtt, presentClinicAtt, clinicAttRate, attByDate, attendanceStreak }
  }, [attendance, clinicAttendance])

  // ── 차트 데이터 ────────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    const trendData: TrendItem[] = weeks
      .slice().sort((a, b) => a.week_number - b.week_number)
      .map((w) => {
        const s = scoreByWeek.get(w.id)
        const ca = classAverages[w.id]
        return {
          label: fmtWeekLabel(w),
          readingRate: s ? weekRate(s, w, 'reading') : null,
          vocabRate: s ? weekRate(s, w, 'vocab') : null,
          classReadingRate: ca?.readingRate ?? null,
          classVocabRate: ca?.vocabRate ?? null,
        }
      })
      .filter((d) => d.readingRate !== null || d.vocabRate !== null || d.classReadingRate !== null || d.classVocabRate !== null)

    const homeworkData: HomeworkItem[] = scoredWeeks
      .map((w) => {
        const s = scoreByWeek.get(w.id)!
        if (w.homework_total === 0 || s.homework_done === null) return null
        return { label: fmtWeekLabel(w), rate: Math.round(s.homework_done / w.homework_total * 100), done: s.homework_done, total: w.homework_total }
      })
      .filter((d): d is HomeworkItem => d !== null)
    const readingTrendData = trendData.filter((d) => d.readingRate !== null || d.classReadingRate !== null)
    const vocabTrendData = trendData.filter((d) => d.vocabRate !== null || d.classVocabRate !== null)
    return { homeworkData, readingTrendData, vocabTrendData }
  }, [weeks, classAverages, scoreByWeek, scoredWeeks, weekRate])

  // ── 분석: 오답 유형 / 레이더 / 반복 패턴 ──────────────────────────────────
  const analysis = useMemo(() => {
    const typeWrongMap = new Map<string, { id: string; name: string; wrong: number; total: number }>()
    const readingAnswers = studentAnswers.filter((a) => a.exam_question?.exam_type === 'reading')
    readingAnswers.forEach((a) => {
      for (const t of a.exam_question?.exam_question_tag ?? []) {
        const tag = t.concept_tag
        if (!tag) continue
        const entry = typeWrongMap.get(tag.id) ?? { id: tag.id, name: tag.name, wrong: 0, total: 0 }
        entry.total++
        if (!a.is_correct) entry.wrong++
        typeWrongMap.set(tag.id, entry)
      }
    })
    const typeData = [...typeWrongMap.values()].filter((d) => d.wrong > 0).sort((a, b) => b.wrong - a.wrong)

    // 카테고리별 정답률 (레이더 차트)
    // 서술형이 없는 학생(모의고사 형태로만 응시)은 카테고리가 독해/문법뿐이라 축이
    // 빈약하다. 이 경우 태그를 수능 영역 단위로 펼친다.
    const expandToDomains = shouldExpandToDomains(studentAnswers)
    const categoryAccMap = new Map<string, { name: string; correct: number; total: number; tags: Map<string, number> }>()
    readingAnswers.forEach((a) => {
      for (const t of a.exam_question?.exam_question_tag ?? []) {
        const tag = t.concept_tag
        const label = expandToDomains
          ? resolveExamDomain(tag?.name ?? '', tag?.category_name ?? null)
          : tag?.category_name ?? null
        if (!label) continue
        const key = expandToDomains ? label : tag!.category_id ?? label
        const entry = categoryAccMap.get(key) ?? { name: label, correct: 0, total: 0, tags: new Map<string, number>() }
        entry.total++
        if (a.is_correct) entry.correct++
        if (tag?.name) entry.tags.set(tag.name, (entry.tags.get(tag.name) ?? 0) + 1)
        categoryAccMap.set(key, entry)
      }
    })
    const radarEntries = [...categoryAccMap.values()]
      .filter((d) => d.total >= 1)
      .sort((a, b) => (expandToDomains ? compareExamDomain(a.name, b.name) : a.name.localeCompare(b.name)))
    const radarData: RadarItem[] = radarEntries.map((d) => ({
      name: d.name, rate: Math.round(d.correct / d.total * 100), correct: d.correct, total: d.total,
    }))
    // 축 설명 패널용 — 축이 실제로 어떤 유형으로 채워졌는지 함께 보여준다
    const radarLegend = radarEntries.map((d) => ({
      name: d.name,
      rate: Math.round(d.correct / d.total * 100),
      desc: describeRadarAxis(d.name),
      tags: [...d.tags.entries()].sort((x, y) => y[1] - x[1]).map(([tagName]) => tagName),
    }))

    // 반복 오답 패턴 (약점 분류)
    const repeatPatterns = classifyPatterns(studentAnswers, weekNumberByWeekId)
    return { typeData, expandToDomains, radarData, radarLegend, repeatPatterns }
  }, [studentAnswers, weekNumberByWeekId])

  // ── 오답노트: 독해 ────────────────────────────────────────────────────────
  const wrongNoteGroups = useMemo(() => visibleWeeks
    .map((w) => {
      const score = scoreByWeek.get(w.id)
      if (!score) return null
      const answers = (answersByScore.get(score.id) ?? [])
        .filter((a) => !a.is_correct && a.exam_question?.exam_type === 'reading')
        .sort((a, b) => {
          const qa = a.exam_question!, qb = b.exam_question!
          if (qa.question_number !== qb.question_number) return qa.question_number - qb.question_number
          return (qa.sub_label ?? '').localeCompare(qb.sub_label ?? '')
        })
      if (answers.length === 0) return null
      return { week: w, answers, className: classes.find((c) => c.id === w.class_id)?.name ?? '' }
    })
    .filter((g): g is NonNullable<typeof g> => g !== null), [visibleWeeks, scoreByWeek, answersByScore, classes])

  // ── 오답노트: 단어 ────────────────────────────────────────────────────────
  const vocabWrong = useMemo(() => {
    const scoreIdToWeekId = new Map(weekScores.map((s) => [s.id, s.week_id]))
    const vocabWrongMap = new Map<string, VocabAnswer[]>()
    vocabAnswers.forEach((va) => {
      const weekId = scoreIdToWeekId.get(va.week_score_id)
      if (!weekId) return
      const list = vocabWrongMap.get(weekId) ?? []
      list.push(va)
      vocabWrongMap.set(weekId, list)
    })
    const vocabWrongGroups: { week: Week; answers: VocabAnswer[]; className: string }[] = []
    for (const [weekId, answers] of vocabWrongMap.entries()) {
      const week = weeks.find((w) => w.id === weekId)
      if (!week) continue
      const className = classes.find((c) => c.id === week.class_id)?.name ?? ''
      // 렌더마다 다시 정렬하지 않도록 여기서 한 번만 정렬
      const sortedAnswers = answers
        .slice()
        .sort((a, b) => (a.test_number ?? a.vocab_word?.number ?? 0) - (b.test_number ?? b.vocab_word?.number ?? 0))
      vocabWrongGroups.push({ week, answers: sortedAnswers, className })
    }
    vocabWrongGroups.sort((a, b) => b.week.week_number - a.week.week_number)
    const vocabAnswerByWordId = new Map<string, VocabAnswer>()
    vocabAnswers.forEach((answer) => {
      if (answer.vocab_word?.id) vocabAnswerByWordId.set(answer.vocab_word.id, answer)
    })
    return { vocabWrongGroups, vocabAnswerByWordId }
  }, [weekScores, vocabAnswers, weeks, classes])

  // ── 사전학습 단어장 그룹 ────────────────────────────────────────────────
  const vocabAnswerByWordId = vocabWrong.vocabAnswerByWordId
  const vocabStudy = useMemo(() => {
    const vocabWordsByWeek = new Map<string, VocabWord[]>()
    vocabWords.forEach((word) => {
      const list = vocabWordsByWeek.get(word.week_id) ?? []
      list.push(word)
      vocabWordsByWeek.set(word.week_id, list)
    })
    const vocabStudyGroups = weeks
      .filter((week) => (vocabWordsByWeek.get(week.id)?.length ?? 0) > 0)
      .map((week) => ({
        week,
        className: classes.find((c) => c.id === week.class_id)?.name ?? '',
        words: (vocabWordsByWeek.get(week.id) ?? []).slice().sort((a, b) => a.number - b.number),
      }))
      .sort((a, b) => b.week.week_number - a.week.week_number)
    const vocabStudyItems: VocabStudyItem[] = vocabStudyGroups
      .flatMap(({ week, words, className }) => words.map((word) => ({
        word,
        week,
        className,
        weekLabel: getWeekLabel(week),
        wrongAnswer: vocabAnswerByWordId.get(word.id) ?? null,
      })))
      .sort((a, b) =>
        a.week.week_number - b.week.week_number ||
        a.word.number - b.word.number
      )
    const vocabWeekOptions = vocabStudyGroups
      .slice()
      .sort((a, b) => a.week.week_number - b.week.week_number)
      .map(({ week }) => ({ id: week.id, label: getWeekLabel(week) }))
    const vocabPassageOptions = [...new Set(
      vocabStudyItems
        .map((item) => item.word.passage_label?.trim())
        .filter((value): value is string => !!value)
    )].sort((a, b) => a.localeCompare(b, 'ko-KR', { numeric: true }))
    const vocabPosOptions = [...new Set(
      vocabStudyItems
        .map((item) => item.word.part_of_speech?.trim())
        .filter((value): value is string => !!value)
    )].sort((a, b) => a.localeCompare(b, 'ko-KR', { numeric: true }))
    return { vocabStudyGroups, vocabStudyItems, vocabWeekOptions, vocabPassageOptions, vocabPosOptions }
  }, [vocabWords, weeks, classes, vocabAnswerByWordId])

  // ── 강사 코멘트 피드 ──────────────────────────────────────────────────────
  const commentFeed = useMemo(() => visibleWeeks
    .filter((w) => scoreByWeek.get(w.id)?.memo)
    .map((w) => ({
      week: w,
      memo: scoreByWeek.get(w.id)!.memo!,
      className: classes.find((c) => c.id === w.class_id)?.name ?? '',
    })), [visibleWeeks, scoreByWeek, classes])

  // ── 홈: 이번 주 리포트 ───────────────────────────────────────────────────
  // 홈은 최신 주차 하나를 "리포트" 로 읽어준다. 헤드라인 문장 규칙은 share-utils 에 있다.
  const { latestW, latestS, prevW } = scoreModel
  const attendanceStreak = attendanceStats.attendanceStreak
  const latestReport = useMemo((): WeeklyReport | null => {
    if (!latestW || !latestS) return null
    const ca = classAverages[latestW.id]
    const prevTotal = (field: ScoreField) =>
      prevW ? (field === 'reading' ? prevW.reading_total : field === 'vocab' ? prevW.vocab_total : prevW.homework_total) : 0
    const metric = (field: ScoreField, correct: number | null, total: number, classAvg: number | null | undefined): WeeklyMetric | null => {
      const rate = weekRate(latestS, latestW, field)
      if (rate === null || correct === null) return null
      return {
        rate, correct, total,
        // 시험 종류가 바뀐 주(문항 수가 크게 다름)의 델타는 실력 변화가 아니라서 숨긴다
        delta: isComparableTotal(total, prevTotal(field)) ? deltas[field] : null,
        classDiff: classAvg !== null && classAvg !== undefined ? rate - classAvg : null,
      }
    }
    const reading = metric('reading', latestS.reading_correct, latestW.reading_total, ca?.readingRate)
    const vocab = metric('vocab', latestS.vocab_correct, latestW.vocab_total, ca?.vocabRate)
    const homework = metric('homework', latestS.homework_done, latestW.homework_total, null)

    const wrongReadingAnswers = (answersByScore.get(latestS.id) ?? [])
      .filter((a) => !a.is_correct && a.exam_question?.exam_type === 'reading')
      .sort((a, b) => a.exam_question!.question_number - b.exam_question!.question_number)
    const wrongVocabAnswers = vocabWrong.vocabWrongGroups.find((g) => g.week.id === latestW.id)?.answers ?? []
    const wrongReading = wrongReadingAnswers.length
    const wrongVocab = wrongVocabAnswers.length

    // 홈에서 바로 보이는 오답 3개 — 독해 문항 먼저, 나머지는 단어로 채운다
    const wrongPreview: WrongPreviewItem[] = [
      ...wrongReadingAnswers.map((a): WrongPreviewItem => ({
        kind: 'reading',
        label: `${a.exam_question!.question_number}번${a.exam_question!.sub_label ?? ''}`,
        detail: a.exam_question!.exam_question_tag.find((t) => t.concept_tag)?.concept_tag?.name ?? null,
      })),
      // 반의어·동의어·파생어 시험은 문제 단어(test_word)가 원본 단어와 다르고, 정답 뜻은
      // 문제 단어 기준이다. 원본 단어를 앞세우면 "various — 동일한" 처럼 뜻이 어긋나 보인다.
      // 오답노트(WrongVocabRow)와 같은 순서: test_word 우선.
      ...wrongVocabAnswers.map((va): WrongPreviewItem => ({
        kind: 'vocab',
        label: va.test_word ?? va.vocab_word?.english_word ?? '?',
        detail: va.vocab_word?.correct_answer ?? null,
      })),
    ].slice(0, 3)

    const retakeTaken = latestS.vocab_retake_correct !== null
    const retakePending = latestS.vocab_correct !== null
      ? Math.max(0, latestW.vocab_total - latestS.vocab_correct - (latestS.vocab_retake_correct ?? 0))
      : 0

    return {
      week: latestW,
      className: classes.find((c) => c.id === latestW.class_id)?.name ?? '',
      reading, vocab, homework,
      wrongReading, wrongVocab,
      memo: latestS.memo?.trim() || null,
      headline: buildWeeklyHeadline({ reading, vocab, homework }),
      notes: buildWeeklyNotes({ reading, vocab, homework, wrongReading, wrongVocab, retakePending, retakeTaken, attendanceStreak }),
      wrongPreview,
    }
  }, [latestW, latestS, prevW, classAverages, weekRate, deltas, answersByScore, vocabWrong.vocabWrongGroups, classes, attendanceStreak])

  // ── 홈: 최근 흐름 (최근 8주) ──────────────────────────────────────────────
  // 기간 전체 평균은 이번 주와 무관한 숫자가 되기 쉬워서 창을 최근 8주로 자른다.
  const recentTrend = useMemo(() => {
    const recent = scoredWeeks.slice(-8)
    const stat = (field: ScoreField, classKey: 'readingRate' | 'vocabRate' | null): TrendStat => {
      const rates: number[] = []
      const diffs: number[] = []
      for (const w of recent) {
        const r = weekRate(scoreByWeek.get(w.id)!, w, field)
        if (r === null) continue
        rates.push(r)
        const ca = classKey ? classAverages[w.id]?.[classKey] : null
        if (ca !== null && ca !== undefined) diffs.push(r - ca)
      }
      return { rates, mean: avg(rates), classDiff: avg(diffs) }
    }
    return {
      weekCount: recent.length,
      reading: stat('reading', 'readingRate'),
      vocab: stat('vocab', 'vocabRate'),
      homework: stat('homework', null),
    }
  }, [scoredWeeks, scoreByWeek, weekRate, classAverages])

  // ── 홈: 반복 약점 한 줄 ───────────────────────────────────────────────────
  // 분석 탭의 패턴 중 고착·악화 상위 1개만 쉬운 말로. 분석 탭으로 가는 미리보기다.
  const topWeakness = useMemo(() => {
    const p = analysis.repeatPatterns.find((x) => x.patternType === 'persistent' || x.patternType === 'deteriorating')
    if (!p) return null
    const text = p.patternType === 'persistent'
      ? `${p.weekCount}회 출제 중 ${p.wrongWeekCount}회 절반 이상 틀렸어요`
      : `최근 정답률 ${p.recentAccuracy}% · 갈수록 낮아지고 있어요`
    return { id: p.id, name: p.name, text }
  }, [analysis.repeatPatterns])

  // ── 오답노트 요약 (탭 상단 카운트) ────────────────────────────────────────
  const wrongNoteSummary = useMemo(() => {
    const readingCount = wrongNoteGroups.reduce((sum, g) => sum + g.answers.length, 0)
    const vocabCount = vocabWrong.vocabWrongGroups.reduce((sum, g) => sum + g.answers.length, 0)
    const retakeRemaining = vocabWrong.vocabWrongGroups.reduce((sum, { week }) => {
      const score = scoreByWeek.get(week.id)
      if (!score || score.vocab_correct === null) return sum
      const originalWrong = week.vocab_total - score.vocab_correct
      return sum + Math.max(0, originalWrong - (score.vocab_retake_correct ?? 0))
    }, 0)
    return { readingCount, vocabCount, retakeRemaining }
  }, [wrongNoteGroups, vocabWrong.vocabWrongGroups, scoreByWeek])

  return {
    classes, periodOptions, weeks, weekScores, studentAnswers, vocabAnswers, vocabWords,
    attendance, clinicAttendance, classAverages,
    periodGroups,
    ...scoreModel,
    ...attendanceStats,
    ...chartData,
    ...analysis,
    latestReport,
    recentTrend,
    topWeakness,
    wrongNoteGroups,
    ...vocabWrong,
    ...vocabStudy,
    commentFeed,
    wrongNoteSummary,
  }
}

export type ShareModel = ReturnType<typeof useShareModel>
