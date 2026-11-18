import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LlmError } from '@/lib/llm/errors'
import { VocabWorkbookFormatError } from '@/lib/vocab-xlsx'
import { POST as parsePdf } from '@/app/api/weeks/[id]/parse-vocab-pdf/route'
import { POST as parseXlsx } from '@/app/api/weeks/[id]/parse-vocab-xlsx/route'
import { POST as saveVocab } from '@/app/api/weeks/[id]/vocab-words/route'

const mocks = vi.hoisted(() => ({
  pdf: vi.fn(),
  xlsx: vi.fn(),
  saveVersion: vi.fn(),
  report: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/api', () => ({
  getAuth: async () => ({ supabase: {}, user: { id: 'teacher' } }),
  getTeacherId: async () => 'teacher',
  assertWeekOwner: async () => true,
  err: (error: string, status = 400) => Response.json({ error }, { status }),
  ok: Response.json,
}))
vi.mock('@/lib/anthropic', () => ({ parseVocabPdf: mocks.pdf }))
vi.mock('@/lib/vocab-xlsx', async (load) => ({
  ...await load<typeof import('@/lib/vocab-xlsx')>(),
  parseVocabWorkbookBuffer: mocks.xlsx,
}))
vi.mock('@/lib/services/week-save', () => ({ captureWeekVersion: mocks.saveVersion }))
vi.mock('@/lib/report-operational-failure', () => ({ reportOperationalFailure: mocks.report }))

const context = { params: Promise.resolve({ id: 'week' }) }
function post(body: object) {
  return new Request('https://edunote.test', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => vi.resetAllMocks())

describe('word-list upload alerts', () => {
  it('reports PDF parser errors and leaves empty results or rejected file types alone', async () => {
    const upload = { fileData: 'data', mimeType: 'application/pdf' }
    mocks.pdf.mockResolvedValueOnce([])
    expect((await parsePdf(post(upload), context)).status).toBe(422)
    expect((await parsePdf(post({ ...upload, mimeType: 'text/plain' }), context)).status).toBe(422)
    mocks.pdf.mockRejectedValueOnce(new LlmError('input_limit', 'too large'))
    await parsePdf(post(upload), context)
    expect(mocks.report).not.toHaveBeenCalled()

    mocks.pdf.mockRejectedValueOnce(new Error('private response text'))
    expect((await parsePdf(post(upload), context)).status).toBe(422)
    expect(mocks.report).toHaveBeenCalledExactlyOnceWith('vocab-upload', 'pdf-parse')
  })

  it('reports spreadsheet parser errors separately from format and empty-file checks', async () => {
    const upload = { fileData: 'ZGF0YQ==', fileName: 'words.xlsx' }
    expect((await parseXlsx(post({ ...upload, fileData: '' }), context)).status).toBe(400)
    expect((await parseXlsx(post({ ...upload, fileName: 'words.csv' }), context)).status).toBe(400)
    mocks.xlsx.mockImplementationOnce(() => { throw new VocabWorkbookFormatError('missing headers') })
    expect((await parseXlsx(post(upload), context)).status).toBe(422)
    expect(mocks.report).not.toHaveBeenCalled()

    mocks.xlsx.mockImplementationOnce(() => { throw new Error('invalid ZIP') })
    expect((await parseXlsx(post(upload), context)).status).toBe(422)
    expect(mocks.report).toHaveBeenCalledExactlyOnceWith('vocab-upload', 'xlsx-parse')
  })

  it('reports storage failures for uploaded sources and skips edits and save conflicts', async () => {
    const words = [{ number: 1, english_word: 'word', correct_answer: '단어' }]
    mocks.saveVersion.mockRejectedValueOnce(new Error('db down'))
    expect((await saveVocab(post({ words }), context)).status).toBe(503)
    mocks.saveVersion.mockRejectedValueOnce({ code: '40001' })
    expect((await saveVocab(post({ words, sourceType: 'xlsx' }), context)).status).toBe(409)
    expect(mocks.report).not.toHaveBeenCalled()

    for (const sourceType of ['xlsx', 'legacy_ai']) {
      mocks.saveVersion.mockRejectedValueOnce(new Error('db down'))
      expect((await saveVocab(post({ words, sourceType }), context)).status).toBe(503)
    }
    expect(mocks.report.mock.calls).toEqual([['vocab-upload', 'words-write'], ['vocab-upload', 'words-write']])
  })
})
