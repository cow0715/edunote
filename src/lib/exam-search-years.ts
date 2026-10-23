/** Inclusive range of years represented by uploaded materials; no invented bounds. */
export function examSearchYears(examYears: (number | null)[]) {
  const years = examYears.filter((year): year is number =>
    typeof year === 'number' && Number.isInteger(year) && year >= 1 && year <= 9999)
  if (!years.length) return []
  const min = Math.min(...years)
  const max = Math.max(...years)
  return Array.from({ length: max - min + 1 }, (_, index) => max - index)
}
