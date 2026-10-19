import type { BookManifest, BookPage, BookQuestionRef, BookUnitManifest } from './types'

const SOURCE_LABEL = /\[수능특강\s*\(영어\)\s*(\d+)강\s*(Gateway(?:\s*\d+번)?|\d+번)\]/g
const GROUP_START = /\[(\d+)\s*[~～]\s*(\d+)\]\s*다음\s*글/
const CIRCLED = '①②③④⑤'

/** Restrict each question's field checks to its own native source block. */
export function nativeBookQuestionText(unit: BookUnitManifest, key: string) {
  const labels = [...unit.left_text.matchAll(SOURCE_LABEL)]
  const index = labels.findIndex((m) => `${Number(m[1])}:${m[2].startsWith('Gateway') ? 'gateway' : 'exercise'}:${Number(m[2].match(/(\d+)번/)?.[1] ?? 1)}` === key)
  if (index < 0) return unit.left_text
  return unit.left_text.slice(labels[index].index! + labels[index][0].length, labels[index + 1]?.index)
}

/** These five separate source rows distinguish explicit (a)…(e) options from inline markers. */
export function nativeBookLetterChoices(unit: BookUnitManifest, key: string) {
  const native = nativeBookQuestionText(unit, key)
  const matches = [...native.matchAll(/(?:^|\n)\s*([①②③④⑤])\s*\(([a-e])\)\s*(?=\n|$)/g)]
  if (matches.length !== 5 || matches.map((m) => m[1]).join('') !== '①②③④⑤' || matches.map((m) => m[2]).join('') !== 'abcde') return null
  return matches.map((m) => `${m[1]} (${m[2]})`)
}

/** Inventory is read from native PDF text, independently of the model's output. */
export function inventoryBook(pages: BookPage[], filename: string): BookManifest {
  const anchors: BookQuestionRef[] = []
  const starts = new Set<number>()
  const errors: string[] = []
  let activeGroup: { start: number; end: number; chapter?: number } | null = null
  for (const page of pages) {
    const group = page.left.match(GROUP_START)
    if (group) { starts.add(page.page); activeGroup = { start: Number(group[1]), end: Number(group[2]) } }
    const matches = [...page.left.matchAll(SOURCE_LABEL)]
    for (const m of matches) {
      const chapter = Number(m[1])
      const section = m[2].startsWith('Gateway') ? 'gateway' : 'exercise'
      const number = Number(m[2].match(/(\d+)번/)?.[1] ?? 1)
      anchors.push({ key: `${chapter}:${section}:${number}`, chapter, section, number,
        label: `${chapter}강 ${section === 'gateway' ? 'Gateway ' : ''}${number}번`, label_page: page.page, printed_answer: null })
    }
    // A regular one-question page starts with a source label. Shared-passage labels
    // can occur below the passage or on the next page, and must not split that set.
    const firstLine = page.left.split('\n').find((line) => line.trim()) ?? ''
    const continuesGroup = activeGroup && matches.every((m) => {
      const number = Number(m[2].match(/(\d+)번/)?.[1] ?? 1)
      return number >= activeGroup!.start && number <= activeGroup!.end && (!activeGroup!.chapter || activeGroup!.chapter === Number(m[1]))
    })
    if (!group && matches.length === 1 && firstLine.includes(matches[0][0]) && !continuesGroup) { starts.add(page.page); activeGroup = null }
    if (activeGroup && matches.length && !activeGroup.chapter) activeGroup.chapter = Number(matches[0][1])
  }
  if (!anchors.length) errors.push('강·Gateway·문항 식별표기를 찾지 못했습니다. 현재는 해당 표기가 있는 좌본문·우해석 교재를 지원합니다.')
  const sortedStarts = [...starts].sort((a, b) => a - b)
  const units: BookUnitManifest[] = sortedStarts.map((start, i) => {
    const end = sortedStarts[i + 1] ? sortedStarts[i + 1] - 1 : pages.length
    const selected = pages.filter((p) => p.page >= start && p.page <= end)
    const questions = anchors.filter((a) => a.label_page >= start && a.label_page <= end)
    const right = selected.map((p) => p.right).join('\n')
    const answers = [...right.matchAll(/\[정답\]\s*([①②③④⑤1-5])/g)].map((m) => CIRCLED.includes(m[1]) ? CIRCLED.indexOf(m[1]) + 1 : Number(m[1]))
    if (!questions.length || answers.length !== questions.length) errors.push(`${start}~${end}쪽: 문항 표기 ${questions.length}개와 원문 정답 ${answers.length}개가 일치하지 않습니다.`)
    if (new Set(questions.map((q) => q.chapter)).size !== 1) errors.push(`${start}~${end}쪽: 강 경계를 확정하지 못했습니다.`)
    if (selected.length > 12) errors.push(`${start}~${end}쪽: 지문 묶음이 너무 큽니다. 페이지 경계 확인이 필요합니다.`)
    questions.forEach((q, n) => { q.printed_answer = answers[n] ?? null })
    const translation = right.match(/\[해석\]([\s\S]*?)(?=\[해설\]|\[풀이\]|\[어휘\]|$)/)?.[1]?.trim() ?? ''
    return { key: `unit-${i + 1}`, order: i + 1, pages: selected.map((p) => p.page), questions,
      left_text: selected.map((p) => p.left).join('\n'), right_text: right, translation,
      ...(selected.some((p) => p.underlines?.length) ? { underlines: selected.flatMap((p) => p.underlines ?? []) } : {}),
      ...(selected.some((p) => p.bold?.length) ? { bold: selected.flatMap((p) => p.bold ?? []) } : {}),
      visual_required: /도표|그래프/.test(selected.map((p) => p.left).join('\n').slice(0, 400)) }
  })
  const assigned = units.flatMap((u) => u.questions.map((q) => q.key))
  if (assigned.length !== anchors.length || new Set(assigned).size !== anchors.length) errors.push('문항 식별표기가 중복되거나 배정되지 않았습니다.')
  const covered = new Set(units.flatMap((u) => u.pages))
  const ignored = pages.filter((p) => !covered.has(p.page)).map((p) => p.page)
  if (ignored.some((n) => n !== 1)) errors.push('표지 외에 처리하지 못한 페이지가 있습니다.')
  const years = [...new Set(pages.flatMap((p) => [...p.full.matchAll(/(20\d{2})\s*학년도/g)].map((m) => Number(m[1]))))]
  const filenameYear = Number(filename.match(/20\d{2}/)?.[0]) || null
  const warnings = ['문항·정답 목록은 원문 텍스트에서 조사하고, 내용·연결·서식은 별도 AI 추출과 대조합니다.']
  if (years.length && filenameYear && !years.includes(filenameYear)) warnings.push(`파일명은 ${filenameYear}년, 인쇄 학년도는 ${years.join(', ')}년입니다. 단일 인쇄 학년도가 있으면 그 값을 적용합니다.`)
  return { version: 1, page_count: pages.length, ignored_pages: ignored, printed_years: years, filename_year: filenameYear,
    question_count: anchors.length, units, errors, warnings }
}
