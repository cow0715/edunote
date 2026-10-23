import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { storageReader } from '../../supabase/functions/storage-usage-reader/handler'
import { fetchDevelopmentStorage, DEV_STORAGE_REF } from '@/lib/costs/supabase-storage'
import { snapshotLabel } from '@/lib/costs/model'
const token = 'a'.repeat(64)
const config = { tokenDigest: createHash('sha256').update(token).digest('hex'), url: `https://${DEV_STORAGE_REF}.supabase.co`, key: 'private-service-key', projectRef: DEV_STORAGE_REF }
const request = () => new Request('https://reader.example', { headers: { Authorization: `Bearer ${token}` } })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('aggregate-only development Storage reader', () => {
  it('labels the shared organization measurement separately from individual projects', () => {
    expect(snapshotLabel('storage_bytes_organization')).toBe('조직 Storage 합계 · 운영+개발')
  })
  it('rejects unauthorized and write requests before touching project data', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const handler = storageReader(config)
    expect((await handler(new Request('https://reader.example'))).status).toBe(401)
    expect((await handler(new Request('https://reader.example', { headers: { Authorization: `Bearer ${'b'.repeat(64)}` } }))).status).toBe(401)
    expect((await handler(new Request('https://reader.example', { method: 'POST' }))).status).toBe(405)
    expect((await storageReader({ ...config, tokenDigest: '' })(request())).status).toBe(503)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('returns only totals and identity, never DB measurements or private fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([{ storage_bytes: '123', files: 4, db_bytes: 900, secret: 'private' }])))
    const response = await storageReader(config)(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ storage_bytes: 123, files: 4, project_ref: DEV_STORAGE_REF, collected_at: expect.any(String) })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
  it('does not invent a zero total when data is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([{ files: 4 }])))
    expect((await storageReader(config)(request())).status).toBe(503)
  })
  it('pins the remote project and rejects partial or misidentified responses', async () => {
    vi.stubEnv('COST_DEV_STORAGE_READER_TOKEN', token)
    const fetcher = vi.fn().mockResolvedValue(Response.json({ project_ref: 'wrong-project', storage_bytes: 123, files: 4, collected_at: new Date().toISOString() })); vi.stubGlobal('fetch', fetcher)
    await expect(fetchDevelopmentStorage()).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledWith(`https://${DEV_STORAGE_REF}.supabase.co/functions/v1/storage-usage-reader`, expect.objectContaining({ redirect: 'error' }))
    fetcher.mockResolvedValue(new Response('', { status: 503 }))
    await expect(fetchDevelopmentStorage()).rejects.toThrow('development_storage_unavailable')
  })
})
