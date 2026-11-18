import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiKeyError, ClientError, MessageNotReceivedError, NetworkError } from 'solapi'
import { readSentryAlert, verifySentrySignature } from '@/lib/kakao-operational-alerts'
import { identifyFailureStage, monitorApi } from '@/lib/report-operational-failure'
import { isLlmProviderFailure, LlmError } from '@/lib/llm/errors'
import { isSolapiProviderFailure } from '@/lib/solapi'
import { register } from '@/instrumentation'
import { POST as sentryWebhook } from '@/app/api/webhooks/sentry-alert/route'

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

function eventBody(area = 'exam-photo', environment = 'production', date = new Date(now).toISOString()) {
  return JSON.stringify({
    action: 'triggered',
    data: {
      event: {
        event_id: id,
        issue_id: '1234',
        project: 42,
        datetime: date,
        tags: [['edunote_environment', environment], ['edunote_area', area]],
        request: { data: 'private student response' },
      },
    },
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
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

  it('extracts only the routing fields and rejects other projects, environments and stale deliveries', () => {
    expect(readSentryAlert(eventBody(), '42', now)).toEqual({ eventId: id, issueId: '1234', area: 'exam-photo' })
    expect(readSentryAlert(eventBody(), '43', now)).toBeNull()
    expect(readSentryAlert(eventBody('exam-photo', 'preview'), '42', now)).toBeNull()
    expect(readSentryAlert(eventBody('kakao-delivery'), '42', now)).toBeNull()
    expect(readSentryAlert(eventBody(), '42', now + 90_000_000)).toBeNull()
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
