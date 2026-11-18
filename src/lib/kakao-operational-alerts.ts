import { createHmac, timingSafeEqual } from 'node:crypto'
import { isOperationalArea, operationalAreas, type OperationalArea } from './operational-alerts'
import { createServiceClient } from './supabase/service'

const TOKEN_TABLE = 'kakao_operational_token'
const DELIVERY_TABLE = 'kakao_operational_delivery'
const DAY_MS = 86_400_000

export function verifySentrySignature(body: Buffer, signature: string | null, secret: string) {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false
  const expected = createHmac('sha256', secret).update(body).digest()
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'))
}

export function readSentryAlert(body: string, projectId: string, now = Date.now()) {
  const payload = JSON.parse(body) as {
    action?: string
    data?: {
      event?: {
        event_id?: string
        issue_id?: string
        project?: number
        datetime?: string
        tags?: [string, unknown][]
      }
    }
  } | null
  if (payload?.action !== 'triggered') return null
  const event = payload.data?.event
  if (!event || String(event.project) !== projectId || typeof event.event_id !== 'string' ||
      !/^[a-f0-9]{32}$/.test(event.event_id) || typeof event.issue_id !== 'string' || !/^\d+$/.test(event.issue_id) ||
      !Array.isArray(event.tags)) return null

  const occurredAt = Date.parse(event.datetime ?? '')
  if (!Number.isFinite(occurredAt) || occurredAt < now - DAY_MS || occurredAt > now + 60_000) return null
  const tags = new Map(event.tags)
  const area = tags.get('edunote_area')
  if (tags.get('edunote_environment') !== 'production' || !isOperationalArea(area) || area === 'kakao-delivery') return null

  return { eventId: event.event_id, issueId: event.issue_id, area }
}

function readKakaoConfig() {
  const appKey = process.env.KAKAO_ALERT_REST_API_KEY
  const clientSecret = process.env.KAKAO_ALERT_CLIENT_SECRET
  if (!appKey) throw new Error('kakao-config-missing')
  return { appKey, clientSecret }
}

async function accessToken(db: ReturnType<typeof createServiceClient>) {
  const { appKey, clientSecret } = readKakaoConfig()
  const now = new Date()
  const seed = process.env.KAKAO_ALERT_INITIAL_REFRESH_TOKEN
  const initial = await db.from(TOKEN_TABLE).select('*').eq('id', 1).maybeSingle()
  if (initial.error) throw new Error('kakao-token-read')
  let stored = initial.data
  if (!stored && seed) {
    const { error: insertError } = await db.from(TOKEN_TABLE)
      .upsert({ id: 1, refresh_token: seed }, { onConflict: 'id', ignoreDuplicates: true })
    if (insertError) throw new Error('kakao-token-seed')
    const read = await db.from(TOKEN_TABLE).select('*').eq('id', 1).single()
    if (read.error) throw new Error('kakao-token-read')
    stored = read.data
  }
  if (!stored) throw new Error('kakao-token-missing')
  if (stored.access_token && Date.parse(stored.access_expires_at) > now.getTime() + 60_000) {
    return stored.access_token as string
  }

  // Coordinate refresh across Vercel instances. In particular, never overwrite a freshly rotated token.
  const lease = new Date(now.getTime() + 30_000).toISOString()
  const { data: locked, error: lockError } = await db.from(TOKEN_TABLE)
    .update({ refresh_locked_until: lease }).eq('id', 1).lt('refresh_locked_until', now.toISOString())
    .select('*').maybeSingle()
  if (lockError) throw new Error('kakao-token-lock')
  if (!locked) {
    // Another delivery is refreshing. Give its result a chance to become available.
    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      const read = await db.from(TOKEN_TABLE).select('access_token,access_expires_at').eq('id', 1).single()
      if (read.error) throw new Error('kakao-token-read')
      if (read.data.access_token && Date.parse(read.data.access_expires_at) > Date.now() + 60_000) {
        return read.data.access_token as string
      }
    }
    throw new Error('kakao-token-refresh-busy')
  }

  try {
    if (locked.access_token && Date.parse(locked.access_expires_at) > Date.now() + 60_000) {
      return locked.access_token as string
    }
    const response = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      signal: AbortSignal.timeout(4_000),
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: appKey,
        refresh_token: locked.refresh_token,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
      }),
    })
    if (!response.ok) throw new Error('kakao-token-refresh')
    const token = await response.json() as { access_token?: string; expires_in?: number; refresh_token?: string }
    if (!token.access_token || !token.expires_in) throw new Error('kakao-token-response')
    const { data, error: saveError } = await db.from(TOKEN_TABLE).update({
      refresh_token: token.refresh_token ?? locked.refresh_token,
      access_token: token.access_token,
      access_expires_at: new Date(now.getTime() + token.expires_in * 1_000).toISOString(),
    }).eq('id', 1).eq('refresh_locked_until', lease).select('id').maybeSingle()
    if (saveError || !data) throw new Error('kakao-token-save')
    return token.access_token
  } finally {
    const { error: unlockError } = await db.from(TOKEN_TABLE)
      .update({ refresh_locked_until: '-infinity' }).eq('id', 1).eq('refresh_locked_until', lease)
    if (unlockError) console.error('[operational-alert] kakao-token-unlock')
  }
}

function sentryIssueLink(issueId?: string) {
  const origin = process.env.SENTRY_ALERT_ISSUE_ORIGIN
  const url = new URL(origin ?? '')
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.sentry.io') || url.username || url.password || url.port) {
    throw new Error('sentry-issue-origin-invalid')
  }
  return new URL(issueId ? `/issues/${issueId}/` : '/issues/', url.origin).href
}

async function sendKakao(db: ReturnType<typeof createServiceClient>, area: OperationalArea, issueId?: string) {
  const link = sentryIssueLink(issueId)
  const token = await accessToken(db)
  const response = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST',
    signal: AbortSignal.timeout(4_000),
    headers: { Authorization: `Bearer ${token}` },
    body: new URLSearchParams({
      template_object: JSON.stringify({
        object_type: 'text',
        text: `EduNote 운영 · ${operationalAreas[area]}`,
        link: { web_url: link, mobile_web_url: link },
        button_title: 'Sentry에서 확인',
      }),
    }),
  })
  if (response.status === 401) {
    // Force the next delivery or maintenance run to refresh a revoked access token.
    await db.from(TOKEN_TABLE).update({ access_expires_at: null }).eq('id', 1).eq('access_token', token)
  }
  if (!response.ok || (await response.json()).result_code !== 0) throw new Error('kakao-message-delivery')
}

export async function deliverSentryAlert(event: NonNullable<ReturnType<typeof readSentryAlert>>) {
  const db = createServiceClient()
  const { data, error } = await db.from(DELIVERY_TABLE)
    .upsert({ event_id: event.eventId }, { onConflict: 'event_id', ignoreDuplicates: true })
    .select('event_id').maybeSingle()
  if (error) throw new Error('kakao-delivery-claim')
  if (!data) return
  await sendKakao(db, event.area, event.issueId)
}

export async function maintainKakaoAlerts() {
  const db = createServiceClient()
  const { error } = await db.from(DELIVERY_TABLE).delete().lt('received_at', new Date(Date.now() - 7 * DAY_MS).toISOString())
  if (error) throw new Error('kakao-delivery-cleanup')
  await accessToken(db)
}
