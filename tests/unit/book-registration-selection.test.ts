import {describe,expect,it} from 'vitest'
import {bookFileIssue,bookSelectionIssue,inferBookSelection,type BookSelection} from '@/lib/book-pdf/registration-selection'
const initial:BookSelection={bookCode:'',academicYear:2027,volume:'full'}
describe('book registration selections before any upload',()=>{
  it.each([
    ['수능영독(상).pdf','suteuk_reading','upper'], ['수특영독(하).pdf','suteuk_reading','lower'],
    ['수완(유형).pdf','suwan_english','type'], ['수완(실전).pdf','suwan_english','practical'],
  ])('infers the verified profile from %s', (name,code,volume)=>{
    const value=inferBookSelection(initial,name)
    expect(value).toEqual({...initial,bookCode:code,volume})
    expect(bookSelectionIssue(value,name)).toBeNull()
  })
  it('updates a replaced file without carrying an incompatible volume or guessing academic year',()=>{
    const reading=inferBookSelection(initial,'수능영독(상).pdf')
    const suwan=inferBookSelection(reading,'2026_수완.pdf')
    expect(suwan).toEqual({bookCode:'suwan_english',volume:'full',academicYear:2027})
    expect(inferBookSelection(reading,'알수없는파일.pdf')).toEqual(reading)
  })
  it('blocks book/part conflicts and incomplete classification before storage',()=>{
    expect(bookSelectionIssue(initial)).toContain('교재')
    expect(bookSelectionIssue({...initial,bookCode:'suteuk_reading',volume:'type'})).toContain('분권')
    expect(bookSelectionIssue({...initial,bookCode:'suteuk_reading'},'수완.pdf')).toContain('교재가 다릅니다')
    expect(bookSelectionIssue({...initial,bookCode:'suwan_english',volume:'type'},'수완(실전).pdf')).toContain('분권이 다릅니다')
    expect(bookSelectionIssue({...initial,bookCode:'suteuk_english',academicYear:0})).toContain('학년도')
  })
  it('distinguishes wrong, empty and oversized files and accepts the 50MB boundary',()=>{
    expect(bookFileIssue({name:'자료.hwp',size:1})).toContain('PDF 형식')
    expect(bookFileIssue({name:'자료.pdf',size:0})).toContain('비어')
    expect(bookFileIssue({name:'자료.pdf',size:50*1024*1024+1})).toContain('50MB')
    expect(bookFileIssue({name:'자료.PDF',size:50*1024*1024})).toBeNull()
  })
})
