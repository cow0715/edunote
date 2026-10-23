import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/pdf-import/gcp', () => ({ workerAccessToken: vi.fn(async () => 'test-token') }))
import { fetchGcpWorkerUsage, summarizeWorkerExecutions } from '@/lib/costs/gcp-worker-usage'
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('worker execution usage', () => {
  it('deduplicates, uses Korean month boundaries and separates success, failure and running wall time', () => {
    const success = { name: 'success', createTime: '2026-09-30T15:00:00Z', startTime: '2026-09-30T15:00:00Z', completionTime: '2026-09-30T15:00:10Z', succeededCount: 1, failedCount: 0, cancelledCount: 0 }
    expect(summarizeWorkerExecutions([success, success,
      { ...success, name: 'excluded', createTime: '2026-09-30T14:59:59Z' },
      { ...success, name: 'failed', succeededCount: 0, failedCount: 1 },
      { ...success, name: 'running', succeededCount: 0, completionTime: undefined },
    ], '2026-10', new Date('2026-09-30T15:01:00Z'))).toEqual({ worker_executions: 3, worker_succeeded: 1, worker_failed: 1, worker_running: 1, worker_wall_seconds: 80 })
  })
})

it('reads all pages, strips container metadata and rejects incomplete pagination', async () => {
  vi.stubEnv('GCP_PROJECT_ID', 'edunote-511708'); vi.stubEnv('GCP_WORKER_REGION', 'asia-northeast3')
  vi.stubEnv('GCP_WEEK_PDF_JOB', 'week'); vi.stubEnv('GCP_BANK_PDF_JOB', 'bank')
  const request = vi.fn(async (url: URL | RequestInfo) => Response.json({ executions: [{ name: String(url).includes('/week/') ? 'week' : 'bank', createTime: '2026-10-22T00:00:00Z', succeededCount: 1, completionTime: '2026-10-22T00:01:00Z', template: { secret: 'never-store' } }] }))
  vi.stubGlobal('fetch', request)
  const result = await fetchGcpWorkerUsage('2026-10')
  expect(result.worker_executions).toBe(2)
  expect(JSON.stringify(result)).not.toContain('never-store')
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ nextPageToken: 'repeated' })))
  await expect(fetchGcpWorkerUsage('2026-10')).rejects.toThrow('worker_usage_pagination_failed')
})
