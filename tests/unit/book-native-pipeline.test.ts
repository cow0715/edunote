import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeFixture } from '../fixtures/book-native'
import { pdfBytes, pdfHash } from '../fixtures/book-pdf'
import { createCallLimiter, withPdfWorkerContext } from '@/lib/pdf-import/context'
import { bookProofMatches } from '@/lib/book-pdf/proof'
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
