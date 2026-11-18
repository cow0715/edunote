import type * as Sentry from '@sentry/node'
import { isOperationalArea, type OperationalArea } from './operational-alerts'

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

      return {
        type: event.type,
        event_id: event.event_id,
        timestamp: event.timestamp,
        platform: 'node',
        environment: 'production',
        release: event.release,
        level: 'error',
        message: `EduNote ${area}: ${failure}`,
        tags: { edunote_environment: 'production', edunote_area: area, edunote_failure: failure },
        fingerprint: ['edunote-operational', area, failure],
      }
    },
  }
}

export async function captureOperationalFailure(
  sentry: Pick<typeof Sentry, 'captureMessage' | 'flush'>,
  area: OperationalArea,
  failure: string,
) {
  sentry.captureMessage(`EduNote ${area}: ${failure}`, {
    level: 'error',
    tags: { edunote_area: area, edunote_failure: failure },
    fingerprint: ['edunote-operational', area, failure],
  })
  if (!(await sentry.flush(2_000))) console.error('[operational-alert] sentry_flush_timeout')
}
