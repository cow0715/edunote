import { after } from 'next/server'
import { isProductionDeployment, type OperationalArea } from './operational-alerts'
import { captureOperationalFailure } from './operational-sentry'

export function reportOperationalFailure(area: OperationalArea, failure: string) {
  if (!isProductionDeployment()) return

  // Only call-site constants and HTTP statuses go into this event.
  console.error('[operational-alert]', area, failure)
  if (!process.env.SENTRY_DSN) return

  try {
    after(async () => {
      try {
        const Sentry = await import('@sentry/nextjs')
        await captureOperationalFailure(Sentry, area, failure)
      } catch {
        console.error('[operational-alert] sentry_capture_failed')
      }
    })
  } catch {
    console.error('[operational-alert] sentry_schedule_failed')
  }
}

const failureStages = new WeakMap<Response, string>()

export function identifyFailureStage(response: Response, stage: string) {
  failureStages.set(response, stage)
  return response
}

export function monitorApi<Args extends unknown[]>(
  area: OperationalArea,
  handler: (...args: Args) => Promise<Response>,
  failurePrefix = 'http',
) {
  return async (...args: Args): Promise<Response> => {
    let response: Response
    try {
      response = await handler(...args)
    } catch (error) {
      reportOperationalFailure(area, `${failurePrefix}-exception`)
      throw error
    }
    if (response.status >= 500) reportOperationalFailure(area, failureStages.get(response) ?? `${failurePrefix}-${response.status}`)
    return response
  }
}
