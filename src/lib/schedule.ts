const DAY_MAP: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

// start_date ~ end_date 사이에서 schedule_days에 해당하는 날짜 목록 반환
export function generateSessionDates(
  startDate: string,
  endDate: string,
  scheduleDays: string[]
): string[] {
  if (!scheduleDays.length) return []

  const dayNums = scheduleDays.map((d) => DAY_MAP[d]).filter((n) => n !== undefined)
  const daySet = new Set(dayNums)

  const dates: string[] = []
  const cur = new Date(startDate)
  const end = new Date(endDate)

  // UTC 기준으로 통일 (toISOString slice 사용)
  while (cur <= end) {
    if (daySet.has(cur.getDay())) {
      dates.push(cur.toISOString().slice(0, 10))
    }
    cur.setDate(cur.getDate() + 1)
  }

  return dates
}
