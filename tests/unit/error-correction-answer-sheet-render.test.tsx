import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
const state = vi.hoisted(() => ({ stem: '①~⑤ 중 틀린 것을 2개 찾아 고치시오.' }))
vi.mock('@/lib/api', () => ({
  getAuth: async () => ({ user: { id: 'user' }, supabase: { from: (table: string) => {
    const data = table === 'week' ? { id: 'week', class_id: 'class', week_number: 1, start_date: '2026-10-01', class: { name: '반' } } : table === 'exam_question' ? ['a', 'e'].map(sub => ({ question_number: 8, sub_label: sub, question_style: 'find_error', question_text: state.stem, source_section: 'written', source_question_number: 2 })) : []
    const builder = { select: () => builder, eq: () => builder, order: () => builder, single: async () => ({ data }), then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: table === 'week' ? [data] : data })) }
    return builder
  } } }),
  getTeacherId: async () => 'teacher', assertWeekOwner: async () => true,
}))
vi.mock('@/lib/class-periods', () => ({ buildWeekDisplayMap: () => new Map() }))
import PrintPage from '@/app/(admin)/dashboard/[classId]/weeks/[weekId]/answer-sheet/print/page'
it('renders exactly two slots for the reported question, and five optional slots for all-selection', async () => {
  let html = renderToStaticMarkup(await PrintPage({ params: Promise.resolve({ classId: 'class', weekId: 'week' }) }))
  expect(html.match(/class="print-error-slot"/g)).toHaveLength(2)
  expect(html).not.toContain('필요한 칸만 작성')
  state.stem = '①~⑤ 중 틀린 것을 모두 찾아 고치시오.'
  html = renderToStaticMarkup(await PrintPage({ params: Promise.resolve({ classId: 'class', weekId: 'week' }) }))
  expect(html.match(/class="print-error-slot"/g)).toHaveLength(5)
  expect(html).toContain('필요한 칸만 작성')
})

import { GET } from '@/app/api/weeks/[id]/answer-sheet-html/route'
it('uses the same slot count and optional guidance in the Word download', async () => {
  state.stem = '①~⑤ 중 틀린 것을 2개 찾아 고치시오.'
  let response = await GET(new Request('https://example.test'), { params: Promise.resolve({ id: 'week' }) })
  let html = await response.text()
  expect(html.match(/번호·기호/g)).toHaveLength(2)
  expect(html).not.toContain('필요한 칸만 작성')
  state.stem = '①~⑤ 중 틀린 것을 모두 찾아 고치시오.'
  response = await GET(new Request('https://example.test'), { params: Promise.resolve({ id: 'week' }) })
  html = await response.text()
  expect(html.match(/번호·기호/g)).toHaveLength(5)
  expect(html).toContain('필요한 칸만 작성')
})
