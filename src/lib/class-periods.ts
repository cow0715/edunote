export type ExamPeriodType = 'midterm' | 'final' | 'other'

export interface ClassPeriod {
  id: string
  class_id: string
  label: string
  semester: 1 | 2
  exam_type: ExamPeriodType
  start_date: string
  end_date: string | null
  is_current: boolean
  sort_order: number
  created_at?: string
  updated_at?: string
}

export interface WeekForPeriod {
  id: string
  class_id: string
  week_number: number
  start_date: string | null
}

export interface WeekDisplayInfo {
  displayLabel: string
  periodLabel: string | null
  periodWeekNumber: number | null
  periodId: string | null
}

export function defaultPeriodLabel(semester: 1 | 2, examType: ExamPeriodType): string {
  if (examType === 'midterm') return `${semester}학기 중간`
  if (examType === 'final') return `${semester}학기 기말`
  return `${semester}학기 기타`
}

export function getWeekDisplayFallback(weekNumber: number): string {
  return `${weekNumber}주차`
}

export function getPeriodForWeek(week: WeekForPeriod, periods: ClassPeriod[]): ClassPeriod | null {
  if (!week.start_date) return null

  const matching = periods
    .filter((period) =>
      period.class_id === week.class_id &&
      period.start_date <= week.start_date! &&
      (!period.end_date || week.start_date! <= period.end_date)
    )
    .sort((a, b) =>
      b.start_date.localeCompare(a.start_date) ||
      b.sort_order - a.sort_order
    )

  return matching[0] ?? null
}

export function buildWeekDisplayMap(
  weeks: WeekForPeriod[],
  periods: ClassPeriod[],
): Map<string, WeekDisplayInfo> {
  const map = new Map<string, WeekDisplayInfo>()
  const weeksByPeriod = new Map<string, WeekForPeriod[]>()

  for (const week of weeks) {
    const period = getPeriodForWeek(week, periods)
    if (!period) {
      map.set(week.id, {
        displayLabel: getWeekDisplayFallback(week.week_number),
        periodLabel: null,
        periodWeekNumber: null,
        periodId: null,
      })
      continue
    }

    const list = weeksByPeriod.get(period.id) ?? []
    list.push(week)
    weeksByPeriod.set(period.id, list)
  }

  for (const [periodId, periodWeeks] of weeksByPeriod.entries()) {
    const period = periods.find((p) => p.id === periodId)
    if (!period) continue

    periodWeeks
      .sort((a, b) =>
        (a.start_date ?? '').localeCompare(b.start_date ?? '') ||
        a.week_number - b.week_number
      )
      .forEach((week, index) => {
        const periodWeekNumber = index + 1
        map.set(week.id, {
          displayLabel: `${period.label} ${periodWeekNumber}주차`,
          periodLabel: period.label,
          periodWeekNumber,
          periodId: period.id,
        })
      })
  }

  return map
}

export function isWeekInPeriod(week: WeekForPeriod, period: ClassPeriod): boolean {
  if (!week.start_date) return false
  return week.class_id === period.class_id &&
    period.start_date <= week.start_date &&
    (!period.end_date || week.start_date <= period.end_date)
}
