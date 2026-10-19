import { beforeEach, describe, expect, it, vi } from 'vitest'
import { document, draft } from '../fixtures/book-pdf'
const mocks = vi.hoisted(() => ({ owned: vi.fn(), rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/book-pdf/server', () => ({ ownedBook: mocks.owned }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }))
import { POST } from '@/app/api/book-pdf/[id]/publish/route'
const params = { params: Promise.resolve({ id: 'doc' }) }
let current = draft()
beforeEach(() => {
  vi.clearAllMocks(); current = draft()
  mocks.from.mockImplementation(() => {
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => query,
      then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data: [current], error: null }).then(resolve) }
    return query
  })
  mocks.owned.mockResolvedValue({ document: document(), teacherId: 'teacher' })
  mocks.rpc.mockResolvedValue({ data: 'bank', error: null })
})
describe('automatic publication authority', () => {
  it('publishes machine-verified units with no human review', async () => {
    expect(current.reviewed_version).toBeNull()
    expect((await POST(new Request('https://example.com'), params)).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('book_pdf_publish', expect.objectContaining({ p_expected_revision: 5, p_hashes: { 'unit-1': current.verification.extraction_hash } }))
  })
  it('rejects human approval without independent machine verification', async () => {
    current.reviewed_version = current.version; current.verified_version = null; current.verification.status = 'pending'
    expect((await POST(new Request('https://example.com'), params)).status).toBe(409)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects text changed after verification even when the stored badge is clean', async () => {
    current.extraction!.questions[0].stem = '검증 이후 변경'
    expect((await POST(new Request('https://example.com'), params)).status).toBe(409)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects a proof for a different PDF', async () => {
    current.verification.pdf_hash = 'different'
    expect((await POST(new Request('https://example.com'), params)).status).toBe(409)
  })
  it('stops at ownership failures', async () => {
    mocks.owned.mockResolvedValue({ response: Response.json({ error: 'owner' }, { status: 404 }) })
    expect((await POST(new Request('https://example.com'), params)).status).toBe(404)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
