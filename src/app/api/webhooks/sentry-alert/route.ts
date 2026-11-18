import { after } from 'next/server'
import { deliverSentryAlert, readSentryAlert, verifySentrySignature } from '@/lib/kakao-operational-alerts'
import { isProductionDeployment } from '@/lib/operational-alerts'
import { reportOperationalFailure } from '@/lib/report-operational-failure'

export async function POST(request: Request) {
  const secret = process.env.SENTRY_ALERT_WEBHOOK_SECRET
  const projectId = process.env.SENTRY_ALERT_PROJECT_ID
  if (!isProductionDeployment() || !secret || !projectId) return new Response(null, { status: 404 })

  const signature = request.headers.get('sentry-hook-signature')
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return new Response(null, { status: 401 })
  const body = Buffer.from(await request.arrayBuffer())
  if (body.length > 256_000) return new Response(null, { status: 413 })
  if (!verifySentrySignature(body, signature, secret)) return new Response(null, { status: 401 })
  if (request.headers.get('sentry-hook-resource') !== 'event_alert') return new Response(null, { status: 204 })

  let event
  try {
    event = readSentryAlert(body.toString('utf8'), projectId)
  } catch {
    return new Response(null, { status: 400 })
  }
  if (!event) return new Response(null, { status: 204 })

  after(async () => {
    try {
      await deliverSentryAlert(event)
    } catch {
      reportOperationalFailure('kakao-delivery', 'webhook-delivery')
    }
  })
  return new Response(null, { status: 202 })
}
