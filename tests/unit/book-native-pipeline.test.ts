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
vi.mock('@/lib/llm/material-enrichment', async (original) => ({ ...await original<typeof import('@/lib/llm/material-enrichment')>(),
  enrichVerifiedMaterialDetailed: async (source: unknown) => ({ supplement: await mocks.enrich(source), model: 'claude-haiku-5-5' }) }))
import { processNativeBookUnit } from '@/lib/book-pdf/native-pipeline'
import { extraction } from '../fixtures/book-pdf'
import * as knownSource from '@/lib/book-pdf/known-source-policy'
import { KNOWN_SOURCE_REVISION } from '@/lib/book-pdf/known-source-policy'
import { writeBookUnitStage } from '@/lib/book-pdf/unit-progress'
import { SourceOutputIncompleteError } from '@/lib/book-pdf/source-output-policy'
import type { LlmDetailedResult } from '@/lib/llm/types'
let fixture = nativeFixture()
const input = () => ({ unit: fixture.unit, pdfHash, bytes: pdfBytes })
beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset()); fixture = nativeFixture()
  mocks.read.mockImplementation(async () => structuredClone(fixture.pages))
  mocks.map.mockImplementation(async () => ({ mapping: structuredClone(fixture.mapping), resolved: { errors: [] } }))
  mocks.render.mockResolvedValue(fixture.images)
  mocks.audit.mockImplementation(async (i) => ({ status: 'audited', groups: i.draft, mapping: i.mapping, audits: [{ status: 'pass' }], errors: [] }))
  mocks.enrich.mockImplementation(async () => ({ questions: fixture.enrichment.questions }))
})

describe('native textbook worker pipeline', () => {
  it('reports the actual output ceiling and blocks enrichment/publication for a truncated image comparison', async () => {
    const error = new SourceOutputIncompleteError('audit', 6000, { stopReason: 'max_tokens', finishReason: 'length' } as LlmDetailedResult)
    mocks.audit.mockRejectedValueOnce(error)
    const result = await processNativeBookUnit(input())
    expect(result.verification).toMatchObject({ status: 'unresolved', exhausted: true, issues: [error.message] })
    expect(result.verification.issues[0]).toContain('6,000토큰')
    expect(result.enrichment).toBeNull()
    expect(mocks.enrich).not.toHaveBeenCalled()
  })
  it('quarantines a known passed/complete cache, reuses its mapping and correction, then requires a new image audit', async () => {
    const h = { manifest: fixture.unit, source: { extraction, verification: fixture.proof, validation: {errors:[],warnings:[],english_coverage:1,translation_coverage:1} } }
    const scope = { pdfHash: h.source.verification.pdf_hash, sourceHash: bookSourceFingerprint(h.manifest) }, saved = new Map<string, unknown>()
    const context = { signal: new AbortController().signal, concurrency: 1, execute: createCallLimiter(1), stage: async () => {},
      read: async <T,>(key: string) => (saved.get(key) ?? null) as T | null,
      write: async (key: string, value: unknown) => { saved.set(key, structuredClone(value)) } }
    const mapping = structuredClone(fixture.mapping)
    mapping.groups[0].questions[0].id = h.manifest.questions[0].key
    await withPdfWorkerContext(context, async () => {
      await writeBookUnitStage(scope,'complete',{ ...h.source, enrichment: fixture.enrichment })
      await writeBookUnitStage(scope,'source',h.source)
      await writeBookUnitStage(scope,'mapping',{nativeHash:bookFingerprint(fixture.pages),attempt:1,errors:[],mapping,model:'claude-sonnet-5-5'})
    })
    const before = [...saved.entries()].map(([key,value]) => [key,JSON.stringify(value)] as const)
    const policySpy=vi.spyOn(knownSource,'knownSourcePolicy').mockReturnValue(knownSource.KNOWN_SOURCE_POLICIES[0])
    const correctionSpy=vi.spyOn(knownSource,'correctKnownSource').mockReturnValue({extraction:{...extraction,translation:'주장하는데, 그 이유는 그들'},replayed:true})
    mocks.audit.mockRejectedValue(new BookBatchPending())
    try {await expect(withPdfWorkerContext(context,()=>processNativeBookUnit({unit:h.manifest,pdfHash:scope.pdfHash,bytes:pdfBytes}))).rejects.toBeInstanceOf(BookBatchPending)}
    finally {policySpy.mockRestore();correctionSpy.mockRestore()}
    expect(mocks.map).not.toHaveBeenCalled(); expect(mocks.enrich).not.toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledOnce()
    const call = mocks.audit.mock.calls[0][0]
    expect(call.checkpoint.sourceRevision).toBe(KNOWN_SOURCE_REVISION)
    expect(call.draft[0].extraction.translation).toContain('주장하는데, 그 이유는 그들')
    for (const [key,value] of before) expect(JSON.stringify(saved.get(key))).toBe(value)
  })
  it('records mixed mapping/supplement/auditor models even after a saved-mapping wait', async () => {
    const saved = new Map<string, unknown>()
    const context = { signal: new AbortController().signal, concurrency: 1, execute: createCallLimiter(1), stage: async () => {},
      read: async <T,>(k: string) => (saved.get(k) ?? null) as T | null,
      write: async (k: string, v: unknown) => { saved.set(k, structuredClone(v)) } }
    mocks.map.mockResolvedValue({ mapping: fixture.mapping, resolved: { errors: [] }, model: 'claude-haiku-5-5-20261007' })
    mocks.audit.mockRejectedValueOnce(new BookBatchPending())
    await expect(withPdfWorkerContext(context, () => processNativeBookUnit(input()))).rejects.toBeInstanceOf(BookBatchPending)
    const result = await withPdfWorkerContext(context, () => processNativeBookUnit(input()))
    expect(result.enrichment?.model).toBe('claude-haiku-5-5')
    expect(result.verification.models).toEqual(expect.arrayContaining(['claude-sonnet-5-5','claude-haiku-5-5','claude-haiku-5-5-20261007']))
    expect(bookProofMatches({ ...result, manifest: fixture.unit, version: 1, verified_version: 1 })).toBe(true)
    expect(mocks.map).toHaveBeenCalledOnce()
  })
  it('resumes a persisted mapping after an audit wait, then reuses complete material after a staging crash', async () => {
    const saved = new Map<string, unknown>()
    const context = { unitKey: fixture.unit.key, signal: new AbortController().signal, concurrency: 1, execute: createCallLimiter(1),
      read: async <T,>(key: string) => saved.get(key) as T ?? null,
      write: async (key: string, value: unknown) => { saved.set(key, structuredClone(value)) }, stage: async () => {} }
    mocks.audit.mockRejectedValueOnce(new BookBatchPending())
    await expect(withPdfWorkerContext(context, () => processNativeBookUnit(input()))).rejects.toBeInstanceOf(BookBatchPending)
    const result = await withPdfWorkerContext(context, () => processNativeBookUnit(input()))
    expect(bookProofMatches({ ...result, manifest: fixture.unit, version: 1, verified_version: 1 })).toBe(true)
    await withPdfWorkerContext(context, () => processNativeBookUnit(input()))
    expect(mocks.map).toHaveBeenCalledOnce(); expect(mocks.audit).toHaveBeenCalledTimes(2); expect(mocks.enrich).toHaveBeenCalledOnce()
  })
  it('holds the first mapping error across restarts and permits only an explicit new mapping attempt', async () => {
    const saved = new Map<string, unknown>()
    const context = { signal: new AbortController().signal, concurrency: 1, execute: createCallLimiter(1),
      read: async <T,>(key: string) => saved.get(key) as T ?? null,
      write: async (key: string, value: unknown) => { saved.set(key, structuredClone(value)) }, stage: async () => {} }
    mocks.map.mockResolvedValueOnce({ mapping: { wrong: 'unchanged rejected output' }, resolved: { errors: ['bad refs'] } })
    expect((await withPdfWorkerContext(context, () => processNativeBookUnit(input()))).verification.status).toBe('unresolved')
    expect((await withPdfWorkerContext(context, () => processNativeBookUnit(input()))).verification.status).toBe('unresolved')
    expect(mocks.map).toHaveBeenCalledOnce(); expect(mocks.audit).not.toHaveBeenCalled()
    const progress = [...saved.values()].find(v => (v as { stage?: string }).stage === 'progress') as { json: string }
    expect(JSON.parse(progress.json)).toMatchObject({ stage: 'mapping', status: 'held', reasons: ['bad refs'] })
    fixture.pages[0].lines[0].x += 1 // A parser coordinate fix still needs an explicit failed-unit resume.
    const result = await withPdfWorkerContext({ ...context, bookResume: { id: '11111111-1111-4111-8111-111111111111', stage: 'mapping' } }, () => processNativeBookUnit(input()))
    expect(result.verification.status).toBe('passed'); expect(mocks.map).toHaveBeenCalledTimes(2)
    expect(mocks.map.mock.calls[1][0]).not.toHaveProperty('repair')
    expect([...saved.keys()].some(key => key.startsWith('book-mapping-history:'))).toBe(true)
  })
  it('never proceeds to a paid audit when saving the accepted mapping fails', async () => {
    await expect(withPdfWorkerContext({ signal: new AbortController().signal, concurrency: 1, execute: createCallLimiter(1),
      read: async () => null, write: async () => {}, writeBookProgress: async (_key, value) => { if ((value as { stage: string }).stage === 'mapping') throw Error('database unavailable') }, stage: async () => {} },
    () => processNativeBookUnit(input()))).rejects.toThrow('database unavailable')
    expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.enrich).not.toHaveBeenCalled()
  })
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
      read: async <T,>(key: string) => (key.startsWith('book-unit-stage:') ? null : { ...source, verification: { ...source.verification, pdf_hash: 'b'.repeat(64) } }) as T, write: async () => {}, stage: async () => {} },
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
  it('holds a wrong question identity without buying a mapping correction', async () => {
    const bad = structuredClone(fixture.mapping); bad.groups[0].questions[0].id = 'wrong'
    mocks.map.mockResolvedValueOnce({ mapping: bad, resolved: { errors: [] } })
    const result = await processNativeBookUnit(input())
    expect(result.verification.status).toBe('unresolved')
    expect(result.verification.issues[0]).toContain('식별자')
    expect(mocks.map).toHaveBeenCalledOnce(); expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('holds a source whose mapping never resolves and does not create images or supplements', async () => {
    mocks.map.mockResolvedValue({ mapping: null, resolved: { errors: ['missing_native'] } })
    expect((await processNativeBookUnit(input())).verification.issues).toContain('missing_native')
    expect(mocks.map).toHaveBeenCalledOnce(); expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.enrich).not.toHaveBeenCalled()
  })
  it('does not reparse a verified source when enrichment encounters a network failure', async () => {
    const saved = new Map<string, unknown>(), controller = new AbortController()
    const context = { signal: controller.signal, concurrency: 1, execute: createCallLimiter(1),
      read: async <T,>(key: string) => (saved.get(key) ?? null) as T | null,
      write: async (key: string, value: unknown) => { saved.set(key, structuredClone(value)) }, stage: async () => {} }
    mocks.enrich.mockRejectedValueOnce(Error('network'))
    const held = await withPdfWorkerContext(context, () => processNativeBookUnit(input()))
    expect(held.verification.failure?.stage).toBe('enrichment')
    expect(held.verification.issues).toContain('network')
    expect((await withPdfWorkerContext(context, () => processNativeBookUnit(input()))).verification.status).toBe('unresolved')
    expect(mocks.enrich).toHaveBeenCalledOnce()
    const result = await withPdfWorkerContext({ ...context, bookResume: { id: '11111111-1111-4111-8111-111111111111', stage: 'enrichment' } }, () => processNativeBookUnit(input()))
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
