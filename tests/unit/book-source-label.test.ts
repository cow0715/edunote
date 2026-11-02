import { describe, expect, it } from 'vitest'
import { bookQuestionPageStart, bookSharedRange, findBookSourceLabels } from '@/lib/book-pdf/source-label'
import { inventoryBook } from '@/lib/book-pdf/inventory'
import pages from '../fixtures/book-profile-pages.json'

describe('verified reading and Suwan source inventory', () => {
  it.each([[0,108,106],[1,120,105],[2,79,75],[3,140,125]])('inventories every question in PDF profile %i', (i, count, units) => {
    const m = inventoryBook(pages[i], 'local.pdf')
    expect(m.errors).toEqual([])
    expect(m.question_count).toBe(count)
    expect(m.units).toHaveLength(units)
    const refs = m.units.flatMap(u => u.questions)
    const range = (start:number,end:number) => Array.from({length:end-start+1},(_,n)=>start+n)
    const expected = i === 0 ? range(1,9).flatMap(c=>range(1,12).map(n=>`reading:chapter:${c}:${n}`))
      : i === 1 ? [...range(10,12).flatMap(c=>range(1,12).map(n=>`reading:chapter:${c}:${n}`)), ...range(1,3).flatMap(c=>range(1,28).map(n=>`reading:mini_test:${c}:${n}`))]
      : i === 2 ? range(1,13).flatMap(c=>[...range(1,c===13?2:1).map(n=>`suwan:type:${c}:practice:${n}`), ...range(1,5).map(n=>`suwan:type:${c}:exercise:${n}`)])
      : range(1,5).flatMap(c=>range(18,45).map(n=>`suwan:practical:${c}:${n}`))
    expect(refs.map(q=>q.key)).toEqual(expected)
    expect(new Set(refs.map(q => q.key)).size).toBe(count)
    expect(refs.every(q => q.printed_answer && q.printed_answer >= 1 && q.printed_answer <= 5)).toBe(true)
    expect(new Set(m.units.flatMap(u => u.pages)).size + m.ignored_pages.length).toBe(pages[i].length)
    expect(Math.max(...m.units.map(u => u.pages.length))).toBe(2)
  })
  it('keeps cross-page shared text before labels and separates Practice from exercises', () => {
    const reading = inventoryBook(pages[1], '').units.find(u => u.questions.some(q => q.key === 'reading:mini_test:2:28'))!
    expect(reading.pages).toEqual([89,90]); expect(reading.questions.map(q => q.number)).toEqual([26,27,28])
    const type = inventoryBook(pages[2], '').units
    expect(type.find(u => u.questions.some(q => q.key === 'suwan:type:13:practice:1'))!.pages).toEqual([74,75])
    expect(type.find(u => u.questions.some(q => q.key === 'suwan:type:13:exercise:1'))!.pages).toEqual([76,77])
    const practical = inventoryBook(pages[3], '').units
    expect(practical.find(u => u.questions.some(q => q.key === 'suwan:practical:5:45'))!.pages).toEqual([134,135])
    expect(practical.filter(u => u.questions[0]?.number === 31).every(u => u.questions.length === 1)).toBe(true)
  })
  it('holds an incomplete shared range even if the same answer was also lost', () => {
    const p = [{page:1,left:'[26~28] 다음 글\n[수능특강(영독) Mini Test 2회 26번]\n[수능특강(영독) Mini Test 2회 28번]',right:'[정답]④\n[정답]⑤',full:''}]
    expect(inventoryBook(p, '').errors.join(' ')).toContain('26~28번')
  })
  it('rejects duplicate left labels, missing answers and unsupported source identities', () => {
    for (const change of ['duplicate','answer','unsupported']) {
      const p = structuredClone(pages[0])
      if (change === 'duplicate') p[2].left = p[1].left
      if (change === 'answer') p[1].right = p[1].right.replace(/\[\s*정답\s*\]/, '[없음]')
      if (change === 'unsupported') p[1].left = p[1].left.replace('영독', '알수없는교재')
      expect(inventoryBook(p, '').errors.length).toBeGreaterThan(0)
    }
  })
  it('keeps legacy English identities and normalizes only source metadata', () => {
    expect(findBookSourceLabels('[수능특강(영어) 2강 Gateway]')[0].ref).toEqual({ key:'2:gateway:1', chapter:2, section:'gateway', number:1, label:'2강 Gateway 1번' })
    expect(findBookSourceLabels('[수능특강 영독 ( ) Mini Test 2 회 28번 ]')[0].ref.key).toBe('reading:mini_test:2:28')
    expect(findBookSourceLabels('[수능완성 유형편 ( ) 13 강 Practice 2]')[0].ref.key).toBe('suwan:type:13:practice:2')
    expect(findBookSourceLabels('[수능완성 실전편 ( ) 5 회 45번 ]')[0].ref.key).toBe('suwan:practical:5:45')
    expect(findBookSourceLabels('[수능특강(영독) 0강 0번]')).toEqual([])
  })
  it('distinguishes shared passages from instructions for independent questions', () => {
    expect(bookSharedRange('[43~45] 다음 글을 읽고, 물음에 답하시오.')).toEqual({start:43,end:45})
    expect(bookSharedRange('[31~34] 다음 빈칸에 들어갈 말로')).toBeNull()
    expect(bookQuestionPageStart('[31~34] 다음 빈칸에 들어갈 말로 가장 적절한 것을 고르시오.')).toBe(true)
    expect(bookQuestionPageStart('Continued sentence.')).toBe(false)
    expect(bookQuestionPageStart('① a\n② b')).toBe(false)
  })
})
