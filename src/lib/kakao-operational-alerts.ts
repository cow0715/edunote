import { createHmac, timingSafeEqual } from 'node:crypto'
import { isOperationalArea, operationalAreas } from './operational-alerts'
import { createServiceClient } from './supabase/service'

const TOKEN_TABLE = 'kakao_operational_token'
const DELIVERY_TABLE = 'kakao_operational_delivery'
const DAY_MS = 86_400_000
const failureStages = new Map([
  ['manual', '테스트 메시지'],
  ['exam-lookup', '시험지 조회 실패'],
  ['questions-lookup', '문항 조회 실패'],
  ['upload-register', 'PDF 처리 작업 등록 실패'],
  ['upload-download', '업로드 파일 다운로드 실패'],
  ['worker-dispatch', 'PDF 워커 실행 요청 실패'],
  ['inline-parsing', '업로드 API에서 PDF 파싱 실패'],
  ['inline-processing', '업로드 API에서 PDF 처리 실패'],
  ['exam-write', '시험지 DB 저장 실패'],
  ['questions-write', '문항 DB 저장 실패'],
  ['explanations-write', '해설 DB 저장 실패'],
  ['worker-incomplete', 'PDF 워커 최종 실패 (미완료 문항)'],
  ['worker-batch-stopped', 'PDF 워커 최종 실패 (배치 중단)'],
  ['worker-retries-exhausted', 'PDF 워커 최종 실패 (자동 재시도 소진)'],
  ['pdf-parse', 'PDF 파싱 실패'],
  ['xlsx-parse', '엑셀 파싱 실패'],
  ['words-write', '단어 DB 저장 실패'],
  ['upload', '답안지 사진 저장 실패'],
  ['verify-storage', '답안지 사진 저장 확인 실패'],
  ['link-job-photo', '채점 작업에 답안지 사진 연결 실패'],
  ['ocr-result-write', '답안지 판독 결과 저장 실패'],
  ['ocr-provider', '외부 사진 판독 서비스 호출 실패'],
  ['sms-provider', '문자 발송 서비스 호출 실패'],
  ['delivery-history-write', '발송 이력 저장 실패'],
  ['http-exception', 'API 처리 중 예외 발생'],
  ['post-exception', '등록 API 처리 중 예외 발생'],
  ['patch-exception', '수정 API 처리 중 예외 발생'],
])

function failureStageLabel(code: unknown) {
  if (typeof code !== 'string') return '실패 단계 미확인'
  const knownStage = failureStages.get(code)
  if (knownStage) return knownStage

  const status = /^(?:http|post|patch)-(5\d\d)$/.exec(code)
  return status ? `API 서버 오류 (HTTP ${status[1]})` : '실패 단계 미확인'
}

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

  const stage = failureStageLabel(tags.get('edunote_failure'))
  return {
    eventId: event.event_id,
    issueId: event.issue_id,
    message: `EduNote 운영 · ${operationalAreas[area]}\n${stage}`,
  }
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

async function sendKakao(db: ReturnType<typeof createServiceClient>, message: string, issueId: string) {
  const link = sentryIssueLink(issueId)
  const token = await accessToken(db)
  const response = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST',
    signal: AbortSignal.timeout(4_000),
    headers: { Authorization: `Bearer ${token}` },
    body: new URLSearchParams({
      template_object: JSON.stringify({
        object_type: 'text',
        text: message,
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
  await sendKakao(db, event.message, event.issueId)
}

export async function maintainKakaoAlerts() {
  const db = createServiceClient()
  const { error } = await db.from(DELIVERY_TABLE).delete().lt('received_at', new Date(Date.now() - 7 * DAY_MS).toISOString())
  if (error) throw new Error('kakao-delivery-cleanup')
  await accessToken(db)
}
