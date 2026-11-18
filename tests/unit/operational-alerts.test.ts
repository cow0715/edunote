import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiKeyError, ClientError, MessageNotReceivedError, NetworkError } from 'solapi'
import { readSentryAlert, verifySentrySignature } from '@/lib/kakao-operational-alerts'
import { identifyFailureStage, monitorApi } from '@/lib/report-operational-failure'
import { isLlmProviderFailure, LlmError } from '@/lib/llm/errors'
import { isSolapiProviderFailure } from '@/lib/solapi'
import { register } from '@/instrumentation'
import { POST as sentryWebhook } from '@/app/api/webhooks/sentry-alert/route'
import { operationalSentryOptions } from '@/lib/operational-sentry'

const webhook = vi.hoisted(() => ({
  callbacks: [] as (() => unknown)[],
  initSentry: vi.fn(),
}))

vi.mock('next/server', () => ({
  after: (callback: () => unknown) => webhook.callbacks.push(callback),
}))

vi.mock('@sentry/nextjs', () => ({ init: webhook.initSentry }))

const now = Date.parse('2026-11-18T04:00:00Z')
const id = 'a'.repeat(32)

function eventBody(area = 'exam-photo', environment = 'production', date = new Date(now).toISOString(), failure?: unknown, workerStage?: unknown) {
  return JSON.stringify({
    action: 'triggered',
    data: {
      event: {
        event_id: id,
        issue_id: '1234',
        project: 42,
        datetime: date,
        tags: [
          ['edunote_environment', environment],
          ['edunote_area', area],
          ...(failure === undefined ? [] : [['edunote_failure', failure]]),
          ...(workerStage === undefined ? [] : [['edunote_worker_stage', workerStage]]),
        ],
        request: { data: 'private student response' },
      },
    },
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  webhook.callbacks.length = 0
  webhook.initSentry.mockClear()
})

describe('Sentry operational alerts', () => {
  it('allows only fixed operational event fields through Sentry in production', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('SENTRY_DSN', 'configured')
    vi.stubEnv('VERCEL_ENV', 'preview')
    await register()
    expect(webhook.initSentry).not.toHaveBeenCalled()

    vi.stubEnv('VERCEL_ENV', 'production')
    await register()
    const options = webhook.initSentry.mock.calls[0][0]
    expect(options.beforeSend({ tags: { edunote_area: 'invalid' } })).toBeNull()
    expect(options.beforeSend({
      event_id: id,
      release: 'commit-sha',
      user: { email: 'private@example.test' },
      request: { data: 'private student response' },
      extra: { secret: 'private' },
      tags: { edunote_area: 'exam-photo', edunote_failure: 'ocr-result-write', added: 'private' },
    })).toEqual({
      event_id: id,
      platform: 'node',
      environment: 'production',
      release: 'commit-sha',
      level: 'error',
      message: 'EduNote exam-photo: ocr-result-write',
      tags: { edunote_environment: 'production', edunote_area: 'exam-photo', edunote_failure: 'ocr-result-write' },
      fingerprint: ['edunote-operational', 'exam-photo', 'ocr-result-write'],
    })
  })

  it('verifies the exact signed bytes', () => {
    const body = Buffer.from(eventBody())
    const signature = createHmac('sha256', 'secret').update(body).digest('hex')
    expect(verifySentrySignature(body, signature, 'secret')).toBe(true)
    expect(verifySentrySignature(Buffer.concat([body, Buffer.from(' ')]), signature, 'secret')).toBe(false)
    expect(verifySentrySignature(body, 'invalid', 'secret')).toBe(false)
  })

  it('includes the allowlisted PDF stage, attempt and execution log link with no raw details', async () => {
    const options = operationalSentryOptions('configured')
    const event = {
      type: undefined,
      timestamp: now / 1_000,
      tags: { edunote_area: 'bank-explanation-upload', edunote_failure: 'worker-retries-exhausted', other: 'secret' },
      contexts: { pdf_worker: {
        stage: 'source-download', attempt: 4, project: 'edunote-511708', region: 'asia-northeast3',
        execution: 'edunote-bank-pdf-x8l5g', error: 'private document content', logs_url: 'https://untrusted.test/',
      } },
    }
    const filtered = await options.beforeSend!(event, {})
    expect(filtered?.tags).toEqual({
      edunote_area: 'bank-explanation-upload', edunote_failure: 'worker-retries-exhausted',
      edunote_environment: 'production', edunote_worker_stage: 'source-download',
    })
    const logsQuery = [
      'resource.type="cloud_run_job"',
      'resource.labels.location="asia-northeast3"',
      'labels."run.googleapis.com/execution_name"="edunote-bank-pdf-x8l5g"',
      'timestamp >= "2026-11-17T04:00:00.000Z"',
      'timestamp <= "2026-11-18T04:05:00.000Z"',
    ].join('\n')
    expect(filtered?.contexts).toEqual({ pdf_worker: {
      stage: 'source-download', attempt: 4,
      logs_url: `https://console.cloud.google.com/logs/query;query=${encodeURIComponent(logsQuery)}?project=edunote-511708`,
    } })

    const invalid = await options.beforeSend!({
      ...event, contexts: { pdf_worker: { ...event.contexts.pdf_worker, execution: '" injected filter', attempt: -1 } },
    }, {})
    expect(invalid?.contexts).toEqual({ pdf_worker: { stage: 'source-download' } })
    const unrelated = await options.beforeSend!({ ...event, tags: { ...event.tags, edunote_area: 'exam-photo' } }, {})
    expect(unrelated?.contexts).toBeUndefined()
  })

  it('extracts only the routing fields and rejects other projects, environments and stale deliveries', () => {
    expect(readSentryAlert(eventBody(), '42', now)).toEqual({
      eventId: id,
      issueId: '1234',
      message: 'EduNote 운영 · 답안지 사진 저장·판독\n실패 단계 미확인',
    })
    expect(readSentryAlert(eventBody(), '43', now)).toBeNull()
    expect(readSentryAlert(eventBody('exam-photo', 'preview'), '42', now)).toBeNull()
    expect(readSentryAlert(eventBody('kakao-delivery'), '42', now)).toBeNull()
    expect(readSentryAlert(eventBody(), '42', now + 90_000_000)).toBeNull()
  })

  it.each([
    ['bank-questions-upload', 'worker-retries-exhausted', '문제지 업로드', 'PDF 워커 최종 실패 (자동 재시도 소진)'],
    ['bank-explanation-upload', 'explanations-write', '해설지 업로드', '해설 DB 저장 실패'],
    ['vocab-upload', 'pdf-parse', '단어장 업로드', 'PDF 파싱 실패'],
    ['vocab-upload', 'xlsx-parse', '단어장 업로드', '엑셀 파싱 실패'],
    ['vocab-upload', 'words-write', '단어장 업로드', '단어 DB 저장 실패'],
    ['grade-save', 'patch-503', '채점 저장', 'API 서버 오류 (HTTP 503)'],
    ['alert-test', 'manual', '운영 알림 테스트', '테스트 메시지'],
  ])('formats %s / %s for KakaoTalk', (area, failure, feature, stage) => {
    const body = eventBody(area, 'production', new Date(now).toISOString(), failure)
    expect(readSentryAlert(body, '42', now)?.message).toBe(`EduNote 운영 · ${feature}\n${stage}`)
  })

  it.each(['unknown-code', 'private student response', 503])('uses a safe fallback for an unknown failure tag (%s)', (failure) => {
    const body = eventBody('exam-photo', 'production', new Date(now).toISOString(), failure)
    expect(readSentryAlert(body, '42', now)?.message).toBe('EduNote 운영 · 답안지 사진 저장·판독\n실패 단계 미확인')
  })

  it('schedules a signed production webhook and rejects unsigned and preview requests', async () => {
    const body = eventBody('exam-photo', 'production', new Date().toISOString())
    const signature = createHmac('sha256', 'secret').update(body).digest('hex')
    function request(value: string) {
      return new Request('https://edunote.test/api/webhooks/sentry-alert', {
        method: 'POST',
        headers: { 'sentry-hook-signature': value, 'sentry-hook-resource': 'event_alert' },
        body,
      })
    }

    vi.stubEnv('SENTRY_ALERT_WEBHOOK_SECRET', 'secret')
    vi.stubEnv('SENTRY_ALERT_PROJECT_ID', '42')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect((await sentryWebhook(request(signature))).status).toBe(404)
    vi.stubEnv('VERCEL_ENV', 'production')
    expect((await sentryWebhook(request(''))).status).toBe(401)
    expect((await sentryWebhook(request(signature))).status).toBe(202)
    expect(webhook.callbacks).toHaveLength(1)
  })

  it('sends one Korean PDF failure message and keeps one delivery for a repeated signed webhook', async () => {
    const db = new PGlite()
    try {
      await db.exec('create role anon; create role authenticated; create role service_role;')
      await db.exec(readFileSync('supabase/migrations/20261118095239_kakao_operational_alerts.sql', 'utf8'))
      vi.stubEnv('VERCEL_ENV', 'production')
      vi.stubEnv('SENTRY_ALERT_WEBHOOK_SECRET', 'test-secret')
      vi.stubEnv('SENTRY_ALERT_PROJECT_ID', '42')
      vi.stubEnv('SENTRY_ALERT_ISSUE_ORIGIN', 'https://edunote.sentry.io')
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.test')
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key')
      vi.stubEnv('KAKAO_ALERT_REST_API_KEY', 'test-app-key')

      const messages: unknown[] = []
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const url = new URL(request.url)
        if (url.origin === 'https://db.test' && url.pathname === '/rest/v1/kakao_operational_delivery') {
          expect(url.searchParams.get('on_conflict')).toBe('event_id')
          expect(request.headers.get('prefer')).toContain('resolution=ignore-duplicates')
          const { event_id } = await request.json() as { event_id: string }
          const { rows } = await db.query('insert into public.kakao_operational_delivery(event_id) values ($1) on conflict (event_id) do nothing returning event_id', [event_id])
          return Response.json(rows)
        }
        if (url.origin === 'https://db.test' && url.pathname === '/rest/v1/kakao_operational_token') {
          return Response.json([{ access_token: 'test-access-token', access_expires_at: new Date(Date.now() + 3_600_000).toISOString() }])
        }
        if (request.url === 'https://kapi.kakao.com/v2/api/talk/memo/default/send') {
          messages.push(JSON.parse((await request.formData()).get('template_object') as string))
          return Response.json({ result_code: 0 })
        }
        throw new Error(`Unexpected test request ${request.url}`)
      }))

      const body = eventBody('bank-questions-upload', 'production', new Date().toISOString(), 'worker-retries-exhausted', 'source-download')
      const signature = createHmac('sha256', 'test-secret').update(body).digest('hex')
      const replayWebhook = async () => {
        const response = await sentryWebhook(new Request('https://edunote.test/api/webhooks/sentry-alert', {
          method: 'POST', body,
          headers: { 'sentry-hook-signature': signature, 'sentry-hook-resource': 'event_alert' },
        }))
        expect(response.status).toBe(202)
        const callback = webhook.callbacks.shift()
        expect(callback).toBeDefined()
        await callback?.()
      }
      await replayWebhook()
      expect(messages).toEqual([{
        object_type: 'text',
        text: 'EduNote 운영 · 문제지 업로드\nPDF 워커 최종 실패 (자동 재시도 소진)\n원인 · 원본 PDF 읽기 실패',
        link: { web_url: 'https://edunote.sentry.io/issues/1234/', mobile_web_url: 'https://edunote.sentry.io/issues/1234/' },
        button_title: 'Sentry에서 확인',
      }])
      await replayWebhook()
      expect(messages).toHaveLength(1)
      expect((await db.query('select event_id from public.kakao_operational_delivery')).rows).toEqual([{ event_id: id }])
    } finally {
      await db.close()
    }
  }, 30_000)

  it('reports only production server failures without changing the response or reading its content', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('SENTRY_DSN', '')
    vi.stubEnv('VERCEL_ENV', 'production')
    const response = new Response('private student response', { status: 503 })
    const handler = monitorApi('grade-save', async (result: Response) => result)
    expect(await handler(response)).toBe(response)
    expect(response.bodyUsed).toBe(false)
    expect(log).toHaveBeenCalledExactlyOnceWith('[operational-alert]', 'grade-save', 'http-503')
    await handler(identifyFailureStage(new Response(null, { status: 503 }), 'ocr-result-write'))
    expect(log).toHaveBeenLastCalledWith('[operational-alert]', 'grade-save', 'ocr-result-write')
    await handler(identifyFailureStage(new Response(null, { status: 409 }), 'conflict'))
    vi.stubEnv('VERCEL_ENV', 'preview')
    await handler(response)
    expect(log).toHaveBeenCalledTimes(2)
  })
})

describe('Solapi outages', () => {
  it('distinguishes provider connectivity, credentials and throttling from per-recipient failures', () => {
    expect(isSolapiProviderFailure(new NetworkError({ url: 'https://api.solapi.com', method: 'POST', cause: null }))).toBe(true)
    expect(isSolapiProviderFailure(new ApiKeyError({ message: 'invalid credentials' }))).toBe(true)
    expect(isSolapiProviderFailure(new ClientError({ errorCode: 'Limited', errorMessage: '', httpStatus: 429 }))).toBe(true)
    expect(isSolapiProviderFailure(new ClientError({ errorCode: 'Invalid', errorMessage: '', httpStatus: 400 }))).toBe(false)
    const failedMessage = {
      to: '01000000000', from: '0200000000', type: 'SMS', country: '82',
      accountId: 'account', messageId: 'message', statusMessage: 'test', statusCode: '1030',
    }
    expect(isSolapiProviderFailure(new MessageNotReceivedError({ failedMessageList: [failedMessage], totalCount: 1 }))).toBe(true)
    expect(isSolapiProviderFailure(new MessageNotReceivedError({
      failedMessageList: [{ ...failedMessage, statusCode: '1011' }], totalCount: 1,
    }))).toBe(false)
  })
})

it('distinguishes OCR provider failures from invalid input and cancelled requests', () => {
  expect(isLlmProviderFailure(new LlmError('network', 'example'))).toBe(true)
  expect(isLlmProviderFailure(new LlmError('provider', 'example'))).toBe(true)
  expect(isLlmProviderFailure(new LlmError('input_limit', 'example'))).toBe(false)
  expect(isLlmProviderFailure(new LlmError('cancelled', 'example'))).toBe(false)
})
