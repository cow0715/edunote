import { bookFileHints, getBook, validBookVolume, type BookCode, type BookVolume } from './catalog'

export type BookSelection = { bookCode: BookCode | ''; academicYear: number; volume: BookVolume }

export function bookFileIssue(file: {name: string; size: number}) {
  if (!/\.pdf$/i.test(file.name)) return 'PDF 형식의 파일을 선택해주세요.'
  if (!file.size) return '선택한 파일이 비어 있습니다. 다른 PDF를 선택해주세요.'
  if (file.size > 50 * 1024 * 1024) return '50MB 이하의 PDF를 선택해주세요.'
  return null
}

/** Filename hints help selection; the printed academic year is confirmed by the
 * user and later checked against the PDF by the existing worker. */
export function inferBookSelection(current: BookSelection, fileName: string): BookSelection {
  const hints = bookFileHints(fileName), bookCode = hints.code ?? current.bookCode
  const candidate = hints.volume ?? current.volume
  return { ...current, bookCode, volume: validBookVolume(bookCode, candidate) ? candidate : 'full' }
}

export function bookSelectionIssue(value: BookSelection, fileName?: string) {
  if (!getBook(value.bookCode)?.supported) return '교재를 선택해주세요.'
  if (!Number.isInteger(value.academicYear) || value.academicYear < 1900 || value.academicYear > 2200) return '교재 표지의 학년도를 확인해주세요.'
  if (!validBookVolume(value.bookCode, value.volume)) return '교재에 맞는 분권을 선택해주세요.'
  if (!fileName) return null
  const hints = bookFileHints(fileName)
  if (hints.code && hints.code !== value.bookCode) return '파일명과 선택한 교재가 다릅니다. 교재를 확인해주세요.'
  if (hints.volume && hints.volume !== value.volume) return '파일명과 선택한 분권이 다릅니다. 상·하 또는 유형편·실전편을 확인해주세요.'
  return null
}
