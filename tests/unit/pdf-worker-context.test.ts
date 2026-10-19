import { describe, expect, it, vi } from 'vitest'
import { checkpointCall, createCallLimiter, getPdfWorkerContext, withPdfWorkerContext, type PdfWorkerContext } from '@/lib/pdf-import/context'

function context(controller = new AbortController()) {
  const saved = new Map<string, unknown>()
  const value: PdfWorkerContext = {
    signal: controller.signal, concurrency: 2, execute: createCallLimiter(2),
    read: async <T>(key: string) => (saved.get(key) ?? null) as T | null,
    write: async (key, result) => { saved.set(key, result) }, stage: vi.fn(),
  }
  return { value, saved }
}
describe('PDF worker checkpoints', () => {
  it('reuses completed responses on a second run but separates changed prompts', async () => {
    const { value, saved } = context()
    const call = vi.fn(async () => ({ items: [18] }))
    await withPdfWorkerContext(value, () => checkpointCall({ prompt: 'a' }, call))
    expect(await withPdfWorkerContext(value, () => checkpointCall({ prompt: 'a' }, call))).toEqual({ items: [18] })
    await withPdfWorkerContext(value, () => checkpointCall({ prompt: 'b' }, call))
    expect(call).toHaveBeenCalledTimes(2)
    expect(saved.size).toBe(2)
    expect(getPdfWorkerContext()).toBeUndefined()
  })
  it('does not checkpoint errors or responses rejected by the validator', async () => {
    const { value, saved } = context()
    await expect(withPdfWorkerContext(value, () => checkpointCall('a', async () => { throw Error('429') }))).rejects.toThrow('429')
    await withPdfWorkerContext(value, () => checkpointCall('b', async () => [], (items) => items.length > 0))
    expect(saved.size).toBe(0)
  })
  it('does not store a result after lease loss and never calls AI when already aborted', async () => {
    const controller = new AbortController()
    const { value, saved } = context(controller)
    await expect(withPdfWorkerContext(value, () => checkpointCall('a', async () => {
      controller.abort(Error('lease lost'))
      return 1
    }))).rejects.toThrow('lease lost')
    const call = vi.fn(async () => 2)
    await expect(withPdfWorkerContext(value, () => checkpointCall('b', call))).rejects.toThrow('lease lost')
    expect(call).not.toHaveBeenCalled()
    expect(saved.size).toBe(0)
  })
  it('does not leak checkpoints into ordinary requests or other jobs', async () => {
    const call = vi.fn(async () => 1)
    await withPdfWorkerContext(context().value, () => checkpointCall('a', call))
    await withPdfWorkerContext(context().value, () => checkpointCall('a', call))
    await checkpointCall('a', call)
    expect(call).toHaveBeenCalledTimes(3)
  })
  it('limits parallel calls and releases a slot even when one fails', async () => {
    const limit = createCallLimiter(2)
    let active = 0
    let maximum = 0
    const results = await Promise.allSettled(Array.from({ length: 7 }, (_, i) => limit(async () => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
      if (i === 0) throw Error('retry')
      return i
    })))
    expect(maximum).toBe(2)
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(6)
    expect(active).toBe(0)
  })
})
