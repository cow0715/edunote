import { describe, expect, it } from 'vitest'
import { BOOK_METADATA_REVISION, oldMetadataRevision, printedBookYears } from '@/lib/book-pdf/academic-year'
import { inventoryBook } from '@/lib/book-pdf/inventory'
import { classificationConflict } from '@/lib/book-pdf/catalog'
import type { BookPage } from '@/lib/book-pdf/types'

const page = (values: Partial<BookPage> = {}): BookPage => ({page: 58, left: '[수능특강(영어독해연습) 12강 1번]\nA passage.', right: '[정답]①\n[해석]2022년과 비교해 2023학년도에는 더 적은 A레벨 언어 응시자 수를 목격했다.', full: '2023학년도에는 더 적은 A레벨 언어 응시자 수를 목격했다.', ...values})

describe('book academic-year evidence', () => {
  it('ignores the actual lower-volume translation and standalone body line wraps', () => {
    expect(printedBookYears([page({metadata_text: ''})])).toEqual([])
    expect(printedBookYears([page()])).toEqual([])
    expect(printedBookYears([page({full:'2023학년도\n에는 더 적은 A레벨 응시자 수'})])).toEqual([])
    const manifest=inventoryBook([page({page:1,metadata_text:''})],'수특영독(하).pdf')
    expect(manifest.printed_years).toEqual([])
    expect(manifest.metadata_revision).toBe(BOOK_METADATA_REVISION)
    expect(classificationConflict({book_code:'suteuk_reading',academic_year:2027},manifest.printed_years)).toBeNull()
  })
  it('keeps actual footer evidence, including page numbers, independent of body years', () => {
    const pages=[page({metadata_text:'2 2027학년도 수능특강 영어'}),page({page:60,metadata_text:'2027학년도 수능특강 영어 60'})]
    expect(printedBookYears(pages)).toEqual([2027])
    expect(classificationConflict({book_code:'suteuk_english',academic_year:2026},printedBookYears(pages))).toContain('2027')
    expect(printedBookYears([page({metadata_text:'2023학년도에는 응시자가 줄었다.'})])).toEqual([])
  })
  it('accepts a cover title while keeping legacy isolated footer fixtures readable', () => {
    expect(printedBookYears([{page:1,left:'교재 표지',right:'',full:'2027학년도 EBS 수능완성 영어',metadata_text:''}])).toEqual([2027])
    expect(printedBookYears([page({full:'A passage.\n2027학년도'})])).toEqual([2027])
    expect(printedBookYears([page({metadata_text:'',full:'A passage.\n2027학년도'})])).toEqual([])
  })
  it('allows only an older well-formed metadata policy to reopen a hold', () => {
    expect(oldMetadataRevision(undefined)).toBe(true)
    expect(oldMetadataRevision(1)).toBe(true)
    for(const value of [BOOK_METADATA_REVISION,3,0,-1,'1',NaN])expect(oldMetadataRevision(value)).toBe(false)
  })
})
