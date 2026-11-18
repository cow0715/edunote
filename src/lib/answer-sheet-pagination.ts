// A4 with 10 mm margins gives 785 pt of height. Reserve the rest for the repeated header.
export const ANSWER_SHEET_TABLE_HEIGHT = 690

export function paginateAnswerSheetRows<T extends { minHeight: number; weight: number }>(rows: T[]) {
  const pages: { rows: T[]; height: number }[] = []
  for (const row of rows) {
    let page = pages.at(-1)
    if (!page || page.height + row.minHeight > ANSWER_SHEET_TABLE_HEIGHT) {
      page = { rows: [], height: 0 }
      pages.push(page)
    }
    page.rows.push(row)
    page.height += row.minHeight
  }

  // Avoid a nearly empty last page when a few rows can be moved intact from the previous page.
  const last = pages.at(-1)
  const previous = pages.at(-2)
  if (last && previous) {
    while (previous.rows.length > 1) {
      const row = previous.rows.at(-1)!
      if (last.height + row.minHeight > ANSWER_SHEET_TABLE_HEIGHT || last.height + row.minHeight >= previous.height) break
      last.rows.unshift(previous.rows.pop()!)
      last.height += row.minHeight
      previous.height -= row.minHeight
    }
  }

  return pages.map((page) => {
    const extra = ANSWER_SHEET_TABLE_HEIGHT - page.height
    const weight = page.rows.reduce((sum, row) => sum + row.weight, 0)
    return page.rows.map((row) => ({
      ...row,
      heightPt: row.minHeight + Math.min(24, Math.floor(extra * row.weight / weight)),
    }))
  })
}
