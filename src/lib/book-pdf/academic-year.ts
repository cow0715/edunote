import type { BookPage } from './types'

/** Changes metadata detection only; paid extraction/repair budgets stay unchanged. */
export const BOOK_METADATA_REVISION = 2

function metadataLineYear(line: string) {
  const text = line.trim()
  // A standalone label or a book title is metadata. A sentence mentioning an
  // academic year (including a translated passage) is not a book classification.
  const match = text.match(/^(?:\d{1,4}\s+)?(20\d{2})\s*학년도(?:\s*(?:EBS\s*)?(?:수능특강|수능완성)(?:\s*영어(?:독해연습)?)?(?:\s*\([상하]\))?)?(?:\s+\d{1,4})?\s*$/)
  return match ? Number(match[1]) : null
}

export function printedBookYears(pages: BookPage[]) {
  const years = new Set<number>()
  for (const page of pages) {
    // New PDF reads preserve the coordinate-derived margins separately. Legacy
    // fixtures/pages may only have full text: exclude anything also in the body.
    const body = `${page.left}\n${page.right}`.replace(/\s/g, '')
    const metadata = page.metadata_text ?? page.full.split('\n').filter((line) => {
      const compact = line.replace(/\s/g, '')
      return !!compact && !body.includes(compact)
    }).join('\n')
    for (const line of metadata.split('\n')) {
      const year = metadataLineYear(line)
      if (year !== null) years.add(year)
    }
    // A cover may place its title/year in the middle of the page. Never treat
    // the first question/answer page as a cover just because it is page one.
    if (page.page === 1 && !/\[\s*(?:수능특강|수능완성|정답|해석|해설)/.test(`${page.left}\n${page.right}`)) {
      for (const line of page.full.split('\n')) {
        const year = metadataLineYear(line)
        if (year !== null) years.add(year)
      }
    }
  }
  return [...years].sort((a, b) => a - b)
}

export function oldMetadataRevision(revision: unknown) {
  const value = revision ?? 1
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value < BOOK_METADATA_REVISION
}
