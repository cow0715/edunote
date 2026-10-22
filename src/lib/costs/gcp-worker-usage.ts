import { z } from 'zod'
import { workerAccessToken } from '../pdf-import/gcp'
import { monthBounds } from './model'

const execution = z.object({ name: z.string(), createTime: z.string().datetime(), startTime: z.string().datetime().optional(), completionTime: z.string().datetime().optional(), succeededCount: z.number().default(0), failedCount: z.number().default(0), cancelledCount: z.number().default(0) })
export function summarizeWorkerExecutions(rows: z.infer<typeof execution>[], month: string, now = new Date()) {
  const bounds = monthBounds(month)
  const unique = new Map(rows.map(row => [row.name, execution.parse(row)]))
  const selected = [...unique.values()].filter(row => row.createTime >= bounds.start && row.createTime < bounds.end)
  return {
    worker_executions: selected.length,
    worker_succeeded: selected.filter(row => row.completionTime && row.failedCount === 0 && row.cancelledCount === 0 && row.succeededCount > 0).length,
    worker_failed: selected.filter(row => row.completionTime && (row.failedCount > 0 || row.cancelledCount > 0)).length,
    worker_running: selected.filter(row => !row.completionTime).length,
    worker_wall_seconds: selected.reduce((sum, row) => sum + (row.startTime ? Math.max(0, (Math.min(Date.parse(row.completionTime ?? now.toISOString()), now.getTime()) - Date.parse(row.startTime)) / 1000) : 0), 0),
  }
}
export async function fetchGcpWorkerUsage(month: string) {
  const project = process.env.GCP_PROJECT_ID
  const region = process.env.GCP_WORKER_REGION
  const jobs = [...new Set([process.env.GCP_WEEK_PDF_JOB, process.env.GCP_BANK_PDF_JOB].filter((s): s is string => !!s))]
  if (!project || !region || jobs.length !== 2 || ![project, region, ...jobs].every(s => /^[a-z0-9-]+$/.test(s))) throw new Error('worker_usage_not_configured')
  const token = await workerAccessToken({ audience: process.env.GCP_WORKLOAD_IDENTITY_AUDIENCE, serviceAccount: process.env.GCP_BILLING_SERVICE_ACCOUNT_EMAIL })
  const signal = AbortSignal.timeout(20000)
  const rows = await Promise.all(jobs.map(async job => {
    const collected: z.infer<typeof execution>[] = []
    let cursor = ''
    const seen = new Set<string>()
    for (let page = 0; page < 20; page++) {
      const url = new URL(`https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}/executions`)
      url.searchParams.set('pageSize', '100')
      if (cursor) url.searchParams.set('pageToken', cursor)
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal })
      if (!response.ok) throw new Error('worker_usage_read_failed')
      // Store only counters and timestamps; execution responses can contain container secrets.
      const result = z.object({ executions: z.array(execution).default([]), nextPageToken: z.string().optional() }).parse(await response.json())
      collected.push(...result.executions)
      if (!result.nextPageToken) return collected
      if (seen.has(result.nextPageToken)) throw new Error('worker_usage_pagination_failed')
      cursor = result.nextPageToken; seen.add(cursor)
    }
    throw new Error('worker_usage_incomplete')
  }))
  return summarizeWorkerExecutions(rows.flat(), month)
}
