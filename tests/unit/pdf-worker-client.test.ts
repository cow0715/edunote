import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvePdfImport } from '@/lib/pdf-import/client'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('PDF job browser polling', () => {
  it('keeps existing synchronous API results usable', async () => {
    const old = { question_count: 28 }
    expect(await resolvePdfImport(old)).toBe(old)
  })
  it('polls short requests, exposes progress, and returns the persisted result', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'running', completed_calls: 1, stage: '추출' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'succeeded', result: { question_count: 28 } }))))
    const progress = vi.fn()
    const pending = resolvePdfImport({ job_id: 'x' }, progress)
    await vi.runAllTimersAsync()
    expect(await pending).toEqual({ question_count: 28 })
    expect(progress).toHaveBeenCalledTimes(2)
  })
  it('stops polling on failure or an uncertain dispatch and directs the user to retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ status: 'failed', error: '일시 오류' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'queued', error: '실행 불명' }))))
    await expect(resolvePdfImport({ job_id: 'x' })).rejects.toThrow('재실행')
    await expect(resolvePdfImport({ job_id: 'x' })).rejects.toThrow('재실행')
  })
  it('allows a stalled queue to recover instead of keeping the upload screen waiting forever', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'queued', can_retry: true }))))
    await expect(resolvePdfImport({ job_id: 'x' })).rejects.toThrow('재실행')
  })
})
