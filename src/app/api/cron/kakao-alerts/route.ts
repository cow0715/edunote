import { maintainKakaoAlerts } from '@/lib/kakao-operational-alerts'
import { isProductionDeployment } from '@/lib/operational-alerts'
import { reportOperationalFailure } from '@/lib/report-operational-failure'

function authorize(request: Request) {
  if (!isProductionDeployment() || !process.env.KAKAO_ALERT_REST_API_KEY) {
    return new Response(null, { status: 404 })
  }
  const secret = process.env.CRON_SECRET
  const expected = Buffer.from(`Bearer ${secret ?? ''}`)
  const supplied = Buffer.from(request.headers.get('authorization') ?? '')
  if (!secret || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return new Response(null, { status: 401 })
  }
}

export async function GET(request: Request) {
  const rejected = authorize(request)
  if (rejected) return rejected
  try {
    await maintainKakaoAlerts()
    return new Response(null, { status: 204 })
  } catch {
    reportOperationalFailure('kakao-delivery', 'token-maintenance')
    return new Response(null, { status: 503 })
  }
}

export async function POST(request: Request) {
  const rejected = authorize(request)
  if (rejected) return rejected
  if (!process.env.SENTRY_DSN) return new Response(null, { status: 503 })
  reportOperationalFailure('alert-test', 'manual')
  return new Response(null, { status: 202 })
}
import { timingSafeEqual } from 'node:crypto'
