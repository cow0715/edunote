import { isProductionDeployment } from '@/lib/operational-alerts'
import { operationalSentryOptions } from '@/lib/operational-sentry'

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !isProductionDeployment() || !process.env.SENTRY_DSN) return

  const Sentry = await import('@sentry/nextjs')
  Sentry.init(operationalSentryOptions(process.env.SENTRY_DSN, process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID))
}
