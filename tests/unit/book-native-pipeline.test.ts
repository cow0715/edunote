import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeFixture } from '../fixtures/book-native'
import { pdfBytes, pdfHash } from '../fixtures/book-pdf'
import { createCallLimiter, withPdfWorkerContext } from '@/lib/pdf-import/context'
import { bookFingerprint, bookSourceFingerprint, bookProofMatches } from '@/lib/book-pdf/proof'
import { BookBatchPending, BookBatchRequestFailed } from '@/lib/book-pdf/batch-policy'
const mocks = vi.hoisted(() => ({ read: vi.fn(), map: vi.fn(), render: vi.fn(), audit: vi.fn(), enrich: vi.fn() }))
vi.mock('@/lib/book-pdf/layout-source', () => ({ readLayoutSource: mocks.read }))
vi.mock('@/lib/book-pdf/map-source', () => ({ mapBookSource: mocks.map }))
vi.mock('@/lib/book-pdf/render-source', () => ({ renderBookSourceImages: mocks.render }))
vi.mock('@/lib/book-pdf/audit-source', () => ({ auditAndRepairSource: mocks.audit }))
vi.mock('@/lib/llm/material-enrichment', async (original) => ({ ...await original<typeof import('@/lib/llm/material-enrichment')>(), enrichVerifiedMaterial: mocks.enrich }))
import { processNativeBookUnit } from '@/lib/book-pdf/native-pipeline'
let fixture = nativeFixture()
const input = () => ({ unit: fixture.unit, pdfHash, bytes: pdfBytes })
beforeEach(() => {
  vi.clearAllMocks(); fixture = nativeFixture()
  mocks.read.mockImplementation(async () => structuredClone(fixture.pages))
  mocks.map.mockImplementation(async () => ({ mapping: structuredClone(fixture.mapping), resolved: { errors: [] } }))
  mocks.render.mockResolvedValue(fixture.images)
  mocks.audit.mockImplementation(async (i) => ({ status: 'audited', groups: i.draft, mapping: i.mapping, audits: [{ status: 'pass' }], errors: [] }))
  mocks.enrich.mockImplementation(async () => ({ questions: fixture.enrichment.questions }))
})

describe('native textbook worker pipeline', () => {
  it('uses the native profile snapshot but still requires original-image audit and supplementation',async()=>{
    const result=await processNativeBookUnit({...input(),prepared:{pages:fixture.pages,mapping:fixture.mapping,reasons:[]}})
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.map.mock.calls[0][0].profileMapping).toEqual(fixture.mapping)
    expect(mocks.render).toHaveBeenCalledOnce();expect(mocks.audit).toHaveBeenCalledOnce();expect(mocks.enrich).toHaveBeenCalledOnce()
    expect(bookProofMatches({...result,manifest:fixture.unit,version:1,verified_version:1})).toBe(true)
  })
  it('reuses an image-verified layout-v1 source after deployment without remapping or rasterizing', async () => {
    const source = await processNativeBookUnit(input())
    const saved = { extraction: source.extraction, validation: source.validation, verification: source.verification }
    const key = bookFingerprint({ pipeline: 'native-image-v1', layout: 1, unit: bookSourceFingerprint(fixture.unit), pdfHash, model: 'claude-sonnet-5-5', render: 'poppler-2000' })
    vi.clearAllMocks()
    const result = await withPdfWorkerContext({ signal: new AbortController().signal, concurrency: 1, execute: (fn) => fn(),
      read: async <T,>(k: string) => (k === key ? saved : null) as T | null, write: async () => {}, stage: async () => {} },
    () => processNativeBookUnit(input()))
    expect(bookProofMatches({ ...result, manifest: fixture.unit, version: 1, verified_version: 1 })).toBe(true)
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.map).not.toHaveBeenCalled(); expect(mocks.render).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('rejects a legacy checkpoint bound to a different PDF', async () => {
    const source = await processNativeBookUnit(input())
    vi.clearAllMocks()
    const result = await withPdfWorkerContext({ signal: new AbortController().signal, concurrency: 1, execute: (fn) => fn(),
      read: async <T,>() => ({ ...source, verification: { ...source.verification, pdf_hash: 'b'.repeat(64) } }) as T, write: async () => {}, stage: async () => {} },
    () => processNativeBookUnit(input()))
    expect(result.verification.pdf_hash).toBe(pdfHash)
    expect(mocks.map).toHaveBeenCalledOnce(); expect(mocks.audit).toHaveBeenCalledOnce()
  })
  it('keeps enrichment input identical after JSONB reorders a verified-source checkpoint', async () => {
    const stored = new Map<string, unknown>()
    const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,sorted(v)])) : value
    const context = { signal: new AbortController().signal, concurrency: 1, execute: createCallLimiter(1),
      read: async <T,>(key: string) => (stored.get(key) ?? null) as T | null,
      write: async (key: string, value: unknown) => { stored.set(key, sorted(value)) }, stage: async () => {},
      batchCall: async () => { throw new BookBatchPending() } }
    const serialized: string[] = []
    mocks.enrich.mockImplementation(async (source) => {
      serialized.push(JSON.stringify(source))
      if (serialized.length === 1) throw new BookBatchPending()
      return { questions: fixture.enrichment.questions }
    })
    await expect(withPdfWorkerContext(context, () => processNativeBookUnit(input()))).rejects.toBeInstanceOf(BookBatchPending)
    expect((await withPdfWorkerContext(context, () => processNativeBookUnit(input()))).verification.status).toBe('passed')
    expect(serialized[0]).toBe(serialized[1])
    expect(mocks.map).toHaveBeenCalledTimes(1)
    expect(mocks.audit).toHaveBeenCalledTimes(1)
  })
  it('suspends mapping without consuming the correction budget or starting image verification', async () => {
    mocks.map.mockRejectedValue(new BookBatchPending())
    await expect(processNativeBookUnit(input())).rejects.toBeInstanceOf(BookBatchPending)
    expect(mocks.map).toHaveBeenCalledTimes(1)
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('holds a permanently failed batch request without spending another correction call', async () => {
    mocks.map.mockRejectedValue(new BookBatchRequestFailed('배치 재요청 3회 소진'))
    const result = await processNativeBookUnit(input())
    expect(result.verification.issues).toEqual(['배치 재요청 3회 소진'])
    expect(mocks.map).toHaveBeenCalledTimes(1)
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('maps, image-audits, then enriches without changing the verified original', async () => {
    const result = await processNativeBookUnit(input())
    expect(result.extraction?.questions[0].solution).toBe('원문 해설')
    expect(result.enrichment?.questions[0].solution).toBe('추가 설명')
    expect(mocks.enrich.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.audit.mock.invocationCallOrder[0])
    expect(mocks.map.mock.calls[0][0]).toMatchObject({ targets: [{ key: '1:exercise:1', label: '1강 1번' }] })
    expect(mocks.map.mock.calls[0][0]).not.toHaveProperty('mode')
    expect(bookProofMatches({ ...result, manifest: fixture.unit, version: 1, verified_version: 1 })).toBe(true)
  })
  it('does not enrich or approve an unresolved image comparison', async () => {
    mocks.audit.mockImplementation(async (i) => ({ status: 'unresolved', groups: i.draft, mapping: i.mapping, audits: [{ status: 'repair' }], errors: ['unreadable'] }))
    const r = await processNativeBookUnit(input())
    expect(r.verification).toMatchObject({ status: 'unresolved', exhausted: true })
    expect(mocks.enrich).not.toHaveBeenCalled()
  })
  it('never truncates an oversized unit to fit the image window', async () => {
    fixture.unit.pages = [1,2,3,4,5]
    expect((await processNativeBookUnit(input())).verification.status).toBe('unresolved')
    expect(mocks.map).not.toHaveBeenCalled(); expect(mocks.render).not.toHaveBeenCalled()
  })
  it('repairs wrong question identities within a bounded mapping budget', async () => {
    const bad = structuredClone(fixture.mapping); bad.groups[0].questions[0].id = 'wrong'
    mocks.map.mockResolvedValueOnce({ mapping: bad, resolved: { errors: [] } })
    expect((await processNativeBookUnit(input())).verification.status).toBe('passed')
    expect(mocks.map).toHaveBeenCalledTimes(2)
    expect(mocks.map.mock.calls[1][0].repair.errors[0]).toContain('식별자')
  })
  it('holds a source whose mapping never resolves and does not create images or supplements', async () => {
    mocks.map.mockResolvedValue({ mapping: null, resolved: { errors: ['missing_native'] } })
    expect((await processNativeBookUnit(input())).verification.issues).toContain('missing_native')
    expect(mocks.map).toHaveBeenCalledTimes(2); expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.enrich).not.toHaveBeenCalled()
  })
  it('does not reparse a verified source when enrichment encounters a network failure', async () => {
    const saved = new Map<string, unknown>(), controller = new AbortController()
    const context = { signal: controller.signal, concurrency: 1, execute: createCallLimiter(1),
      read: async <T,>(key: string) => (saved.get(key) ?? null) as T | null,
      write: async (key: string, value: unknown) => { saved.set(key, structuredClone(value)) }, stage: async () => {} }
    mocks.enrich.mockRejectedValueOnce(Error('network'))
    await expect(withPdfWorkerContext(context, () => processNativeBookUnit(input()))).rejects.toThrow('network')
    const result = await withPdfWorkerContext(context, () => processNativeBookUnit(input()))
    expect(result.verification.status).toBe('passed')
    expect(mocks.map).toHaveBeenCalledTimes(1); expect(mocks.audit).toHaveBeenCalledTimes(1); expect(mocks.enrich).toHaveBeenCalledTimes(2)
  })
  it('uses repaired image text as authority when PDF.js text was wrong', async () => {
    mocks.audit.mockImplementation(async (i) => {
      i.draft[0].extraction.passage = 'Corrected image source.'
      return { status: 'audited', groups: i.draft, mapping: i.mapping, audits: [{ status: 'repair' },{ status: 'pass' }], errors: [] }
    })
    const r = await processNativeBookUnit(input())
    expect(r.extraction?.passage).toBe('Corrected image source.')
    expect(r.verification.status).toBe('passed')
    expect(mocks.enrich.mock.calls[0][0].passage).toBe('Corrected image source.')
  })
})
