/** Registration choices are metadata; support is granted only for a verified PDF layout. */
export const BOOK_CODES = ['suteuk_english', 'suteuk_reading', 'suwan_english'] as const
export type BookCode = typeof BOOK_CODES[number]
export const BOOK_VOLUMES = ['full', 'upper', 'lower'] as const
export type BookVolume = typeof BOOK_VOLUMES[number]
export const BOOK_CATALOG = [
  { code: 'suteuk_english', label: '수능특강 영어', supported: true, description: '강·Gateway·문항 표기가 있는 좌본문·우해석 PDF' },
  { code: 'suteuk_reading', label: '수능특강 영어독해연습', supported: false, description: 'PDF 형식 확인 전 · 등록 준비 중' },
  { code: 'suwan_english', label: '수능완성 영어', supported: false, description: 'PDF 형식 확인 전 · 등록 준비 중' },
] as const
export const VOLUME_LABELS: Record<BookVolume, string> = { full: '전체', upper: '상', lower: '하' }
export function getBook(code: unknown) { return BOOK_CATALOG.find((book) => book.code === code) }
export function bookTitle(code: BookCode, year: number | null, volume: BookVolume | null) {
  return `${year ? `${year}학년도 ` : ''}${getBook(code)!.label}${volume && volume !== 'full' ? ` · ${VOLUME_LABELS[volume]}` : ''}`
}
export function bookFileHints(name: string): { code: BookCode | null; volume: BookVolume | null; year: number | null } {
  const text = name.normalize('NFKC')
  const code = /수능완성|수완/.test(text) ? 'suwan_english'
    : /영어?독해|독해연습|독해와작문|영독/.test(text) ? 'suteuk_reading'
    : /수능특강|수특/.test(text) && /영어/.test(text) ? 'suteuk_english' : null
  const volume = /[([]상[)\]]|(?:^|[ _·])상(?:$|[ _·])/.test(text) ? 'upper'
    : /[([]하[)\]]|(?:^|[ _·])하(?:$|[ _·])/.test(text) ? 'lower' : null
  return { code, volume, year: Number(text.match(/(?:19|20|21)\d{2}/)?.[0]) || null }
}
export function classificationConflict(input: { book_code?: string | null; academic_year: number | null }, printedYears: number[]) {
  if (!input.book_code || !input.academic_year || printedYears.length !== 1 || printedYears[0] === input.academic_year) return null
  return `선택한 ${input.academic_year}학년도와 PDF에 인쇄된 ${printedYears[0]}학년도가 다릅니다. 분류를 수정한 뒤 같은 작업을 이어 처리하세요.`
}
