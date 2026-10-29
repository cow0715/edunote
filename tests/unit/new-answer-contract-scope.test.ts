import { beforeEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExistingAnswerKey } from '@/lib/week-answer-review'
const mocks = vi.hoisted(() => ({ parse: vi.fn() }))
vi.mock('@/lib/week-reading-import', () => ({ parseAnswerSheetDocument: mocks.parse }))
import { createWeekAnswerDraft } from '@/lib/week-answer-review-server'
beforeEach(() => mocks.parse.mockReset().mockResolvedValue({ answers: [], skipped: [] }))
it.each([false, true])('selects strict extraction only when there are no existing questions: existing=%s', async existing => {
  const insert = vi.fn((row: unknown) => ({ row, select: () => ({ single: async () => ({ data: { id: 'draft' }, error: null }) }) }))
  const client = { from: () => ({ insert }) } as unknown as SupabaseClient
  const baseQuestions: ExistingAnswerKey[] = existing ? [{ id: 'q', question_number: 1, sub_label: null, question_style: 'objective', correct_answer: 3, correct_answer_text: null }] : []
  await createWeekAnswerDraft(client, { teacherId: 't', weekId: 'w', baseQuestions, files: [{ fileData: 'dGVzdA==', mimeType: 'image/png', fileName: 'source.png' }] })
  expect(mocks.parse.mock.calls[0][2]).toEqual({ validateAnswerContract: !existing })
  expect(insert.mock.calls[0][0]).toMatchObject({ base_questions: baseQuestions })
})
