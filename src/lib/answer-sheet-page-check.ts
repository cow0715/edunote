type UploadedSheet = {
  b64: string | null
  mimeType: string
  pageCount?: number
  sheetPage?: number
  sheetPages?: (number | null)[]
}

export function checkAnswerSheetPages(files: readonly UploadedSheet[], expected: number) {
  const seen = new Set<number>()
  const duplicate = new Set<number>()
  const unexpected = new Set<number>()
  const uploads = new Map<string, Set<string>>()
  let repeatedFile = false
  let total = 0
  let unknown = 0

  for (const file of files) {
    const count = file.pageCount ?? 1
    total += count
    if (file.b64) {
      const previous = uploads.get(file.mimeType) ?? new Set<string>()
      repeatedFile ||= previous.has(file.b64)
      previous.add(file.b64)
      uploads.set(file.mimeType, previous)
    }
    for (let index = 0; index < count; index++) {
      const page = file.sheetPages?.[index] ?? (index === 0 ? file.sheetPage : undefined)
      if (!page) {
        unknown++
        continue
      }
      if (seen.has(page)) duplicate.add(page)
      if (page > expected) unexpected.add(page)
      seen.add(page)
    }
  }

  const missing = Array.from({ length: expected }, (_, index) => index + 1).filter((page) => !seen.has(page))
  const issues: string[] = []
  if (!unknown && missing.length) issues.push(`${missing.join(', ')}쪽 누락`)
  else if (missing.length > unknown) issues.push(`최소 ${missing.length - unknown}쪽 누락`)
  if (duplicate.size) issues.push(`${[...duplicate].sort((a, b) => a - b).join(', ')}쪽 중복`)
  else if (repeatedFile) issues.push('같은 파일 중복')
  if (unexpected.size) issues.push(`답안지 범위 밖 ${[...unexpected].sort((a, b) => a - b).join(', ')}쪽`)
  if (total > expected && !duplicate.size && !repeatedFile && !unexpected.size) issues.push(`예상보다 ${total - expected}쪽 많음`)
  if (unknown && (expected > 1 || total > 1)) issues.push(`${unknown}쪽의 인쇄 쪽수 확인 필요`)
  return issues
}
