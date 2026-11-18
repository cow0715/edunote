import type * as Sentry from '@sentry/node'
import { isOperationalArea, isPdfWorkerFailure, isPdfWorkerFailureStage, type OperationalArea, type PdfWorkerFailureStage } from './operational-alerts'

type PdfWorkerContext = {
  stage: PdfWorkerFailureStage
  attempt?: number
  project?: string
  region?: string
  execution?: string
}

function cloudRunLogsUrl(project: unknown, region: unknown, execution: unknown, timestamp?: number) {
  if (typeof project !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) ||
      typeof region !== 'string' || !/^[a-z]+-[a-z0-9]{1,24}[0-9]$/.test(region) ||
      typeof execution !== 'string' || !/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(execution)) return undefined

  const query = [
    'resource.type="cloud_run_job"',
    `resource.labels.location="${region}"`,
    `labels."run.googleapis.com/execution_name"="${execution}"`,
  ]
  if (timestamp !== undefined) {
    const eventMs = timestamp * 1_000
    const start = new Date(eventMs - 24 * 60 * 60 * 1_000)
    const end = new Date(eventMs + 5 * 60 * 1_000)
    if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())) {
      query.push(`timestamp >= "${start.toISOString()}"`, `timestamp <= "${end.toISOString()}"`)
    }
  }
  return `https://console.cloud.google.com/logs/query;query=${encodeURIComponent(query.join('\n'))}?project=${project}`
}

export function operationalSentryOptions(dsn: string, release?: string): NonNullable<Parameters<typeof Sentry.init>[0]> {
  return {
    dsn,
    environment: 'production',
    release,
    defaultIntegrations: false,
    enableOpenTelemetrySetup: false,
    dataCollection: { userInfo: false },
    beforeSend(event) {
      const area = event.tags?.edunote_area
      const failure = event.tags?.edunote_failure
      if (!isOperationalArea(area) || typeof failure !== 'string' || !/^[a-z0-9-]{1,60}$/.test(failure)) return null

      const worker = event.contexts?.pdf_worker
      const stage = worker?.stage
      const tags = { edunote_environment: 'production', edunote_area: area, edunote_failure: failure }
      const base = {
        type: event.type,
        event_id: event.event_id,
        timestamp: event.timestamp,
        platform: 'node',
        environment: 'production',
        release: event.release,
        level: 'error' as const,
        message: `EduNote ${area}: ${failure}`,
        tags,
        fingerprint: ['edunote-operational', area, failure],
      }
      if (!isPdfWorkerFailure(area, failure) || !worker || !isPdfWorkerFailureStage(stage)) return base

      const attempt = worker.attempt
      const logsUrl = cloudRunLogsUrl(worker.project, worker.region, worker.execution, event.timestamp)
      return {
        ...base,
        tags: { ...tags, edunote_worker_stage: stage },
        contexts: {
          pdf_worker: {
            stage,
            ...(typeof attempt === 'number' && Number.isSafeInteger(attempt) && attempt > 0 ? { attempt } : {}),
            ...(logsUrl ? { logs_url: logsUrl } : {}),
          },
        },
      }
    },
  }
}

export async function captureOperationalFailure(
  sentry: Pick<typeof Sentry, 'captureMessage' | 'flush'>,
  area: OperationalArea,
  failure: string,
  worker?: PdfWorkerContext,
) {
  sentry.captureMessage(`EduNote ${area}: ${failure}`, {
    level: 'error',
    tags: { edunote_area: area, edunote_failure: failure },
    fingerprint: ['edunote-operational', area, failure],
    ...(worker ? { contexts: { pdf_worker: worker } } : {}),
  })
  if (!(await sentry.flush(2_000))) console.error('[operational-alert] sentry_flush_timeout')
}
