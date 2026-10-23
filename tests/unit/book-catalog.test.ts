import { describe, expect, it } from 'vitest'
import { BOOK_CATALOG, bookFileHints, bookTitle, classificationConflict } from '@/lib/book-pdf/catalog'
import { bookProgress } from '@/lib/book-pdf/progress'
import { bookUploadSchema } from '@/lib/book-pdf/registration-schema'
import { bankTab, mergeBankSearch } from '@/lib/exam-bank-navigation'

describe('book registration metadata', () => {
  it('offers all three books but supports only the verified English layout', () => {
    expect(BOOK_CATALOG).toHaveLength(3)
    expect(BOOK_CATALOG.filter((b) => b.supported).map((b) => b.code)).toEqual(['suteuk_english'])
  })
  it('keeps filename year separate from the academic year and recognizes upper volumes', () => {
    expect(bookFileHints('2026_[수특영어(상)]_좌본문우해석.pdf')).toEqual({ code: 'suteuk_english', year: 2026, volume: 'upper' })
    expect(bookTitle('suteuk_english', 2027, 'upper')).toBe('2027학년도 수능특강 영어 · 상')
    expect(bookFileHints('수능특강 영어독해와작문.pdf').code).toBe('suteuk_reading')
    expect(bookFileHints('수능완성 영어.pdf').code).toBe('suwan_english')
  })
  it('holds an explicit academic-year conflict before a model call without affecting legacy metadata', () => {
    expect(classificationConflict({ book_code: 'suteuk_english', academic_year: 2026 }, [2027])).toContain('2027')
    expect(classificationConflict({ academic_year: 2026 }, [2027])).toBeNull()
    expect(classificationConflict({ book_code: 'suteuk_english', academic_year: 2027 }, [2027])).toBeNull()
  })
  it('requires structured metadata and a PDF instead of accepting only a free title', () => {
    expect(bookUploadSchema.safeParse({ title: '교재', fileName: 'x.pdf', storagePath: 'a/b' }).success).toBe(false)
    expect(bookUploadSchema.safeParse({ bookCode: 'suteuk_english', academicYear: 2027, volume: 'upper', fileName: 'x.pdf', storagePath: 'a/b' }).success).toBe(true)
  })
  it('uses actual completed units, keeps waiting_batch active and preserves navigation in search URLs', () => {
    expect(bookProgress({ units: [1, 2, 3], question_count: 7 }, 2)).toEqual({ total: 3, completed: 2, questions: 7 })
    expect(bookProgress(null, 3)).toEqual({ total: 0, completed: 0, questions: 0 })
    expect(bankTab('book')).toBe('import')
    expect(bankTab(null)).toBe('search')
    const params = new URLSearchParams(mergeBankSearch('q=vaccine&source=교재', '?tab=search&document=doc&material=bank&grade=3'))
    expect(params.get('tab')).toBe('search'); expect(params.get('document')).toBe('doc'); expect(params.get('q')).toBe('vaccine'); expect(params.has('grade')).toBe(false)
  })
})
