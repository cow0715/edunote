import { useQuery } from '@tanstack/react-query'

// Raw API response types
type RawTagResult = {
  tagId: string
  correct: number
  total: number
}

type RawWeeklyResult = {
  weekId: string
  weekNumber: number
  className: string
  startDate: string | null
  tagResults: RawTagResult[]
}

type RawCategory = {
  id: string
  name: string
  sort_order: number
}

type RawTag = {
  id: string
  name: string
  category_id: string
  category_name: string
  sort_order: number
}

type RawStudent = {
  id: string
  name: string
  grade: string | null
  school: string | null
}

type WeaknessApiResponse = {
  student: RawStudent
  categories: RawCategory[]
  tags: RawTag[]
  weeklyResults: RawWeeklyResult[]
}

export type TagWeekResult = {
  tagId: string
  tagName: string
  categoryId: string
  categoryName: string
  correct: number
  total: number
  accuracy: number
}

export type WeekData = {
  weekId: string
  weekNumber: number
  className: string
  startDate: string | null
  tagResults: TagWeekResult[]
}

export type TagSummary = {
  tagId: string
  tagName: string
  categoryId: string
  categoryName: string
  totalCorrect: number
  totalCount: number
  overallAccuracy: number
  firstAccuracy: number
  latestAccuracy: number
  prevAccuracy: number
  diff: number
  recentDiff: number
  weekCount: number
  weeks: { weekNumber: number; accuracy: number }[]
}

export type WeaknessData = {
  student: RawStudent
  categories: RawCategory[]
  tags: RawTag[]
  weeks: WeekData[]
  tagSummaries: TagSummary[]
}

async function fetchWeaknessData(studentId: string): Promise<WeaknessData> {
  const res = await fetch(`/api/students/${studentId}/weakness`)
  if (!res.ok) throw new Error('약점 데이터 조회 실패')
  const raw: WeaknessApiResponse = await res.json()

  // tag id -> tag info 맵
  const tagMap = new Map(raw.tags.map((t) => [t.id, t]))

  // WeekData 변환
  const weeks: WeekData[] = raw.weeklyResults.map((wr) => ({
    weekId: wr.weekId,
    weekNumber: wr.weekNumber,
    className: wr.className,
    startDate: wr.startDate,
    tagResults: wr.tagResults.map((tr) => {
      const tag = tagMap.get(tr.tagId)
      return {
        tagId: tr.tagId,
        tagName: tag?.name ?? tr.tagId,
        categoryId: tag?.category_id ?? '',
        categoryName: tag?.category_name ?? '',
        correct: tr.correct,
        total: tr.total,
        accuracy: tr.total > 0 ? Math.round((tr.correct / tr.total) * 100) : 0,
      }
    }),
  }))

  // TagSummary 집계
  const tagAccumMap = new Map<string, {
    tag: RawTag
    totalCorrect: number
    totalCount: number
    weekEntries: { weekNumber: number; correct: number; total: number }[]
  }>()

  for (const week of weeks) {
    for (const tr of week.tagResults) {
      const tag = tagMap.get(tr.tagId)
      if (!tag) continue
      const prev = tagAccumMap.get(tr.tagId) ?? {
        tag,
        totalCorrect: 0,
        totalCount: 0,
        weekEntries: [],
      }
      prev.totalCorrect += tr.correct
      prev.totalCount += tr.total
      prev.weekEntries.push({ weekNumber: week.weekNumber, correct: tr.correct, total: tr.total })
      tagAccumMap.set(tr.tagId, prev)
    }
  }

  const tagSummaries: TagSummary[] = []
  for (const [tagId, acc] of tagAccumMap.entries()) {
    const sortedWeeks = acc.weekEntries
      .sort((a, b) => a.weekNumber - b.weekNumber)
      .map((e) => ({
        weekNumber: e.weekNumber,
        accuracy: e.total > 0 ? Math.round((e.correct / e.total) * 100) : 0,
      }))

    const weekCount = sortedWeeks.length
    const firstAccuracy = weekCount > 0 ? sortedWeeks[0].accuracy : 0
    const latestAccuracy = weekCount > 0 ? sortedWeeks[weekCount - 1].accuracy : 0
    const prevAccuracy = weekCount > 1 ? sortedWeeks[weekCount - 2].accuracy : latestAccuracy
    const overallAccuracy = acc.totalCount > 0
      ? Math.round((acc.totalCorrect / acc.totalCount) * 100)
      : 0

    tagSummaries.push({
      tagId,
      tagName: acc.tag.name,
      categoryId: acc.tag.category_id,
      categoryName: acc.tag.category_name,
      totalCorrect: acc.totalCorrect,
      totalCount: acc.totalCount,
      overallAccuracy,
      firstAccuracy,
      latestAccuracy,
      prevAccuracy,
      diff: latestAccuracy - firstAccuracy,
      recentDiff: latestAccuracy - prevAccuracy,
      weekCount,
      weeks: sortedWeeks,
    })
  }

  // sort by overallAccuracy asc (약한 것 먼저)
  tagSummaries.sort((a, b) => a.overallAccuracy - b.overallAccuracy)

  return {
    student: raw.student,
    categories: raw.categories,
    tags: raw.tags,
    weeks,
    tagSummaries,
  }
}

export function useWeaknessData(studentId: string | null) {
  return useQuery({
    queryKey: ['weakness', studentId],
    queryFn: () => fetchWeaknessData(studentId!),
    enabled: !!studentId,
  })
}
