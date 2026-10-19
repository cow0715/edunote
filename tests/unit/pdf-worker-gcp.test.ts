import { generateKeyPairSync, verify } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServiceAccountAssertion, dispatchPdfJob, gcpWorkerConfig } from '@/lib/pdf-import/gcp'

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const key = { client_email: 'dispatcher@example.iam.gserviceaccount.com', private_key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }
const requestHeaders = vi.hoisted(() => ({ token: 'request-oidc' as string | null }))
vi.mock('next/headers', () => ({ headers: async () => new Headers(requestHeaders.token ? { 'x-vercel-oidc-token': requestHeaders.token } : {}) }))
function env() {
  vi.stubEnv('GCP_PROJECT_ID', 'edunote-test')
  vi.stubEnv('GCP_WORKER_REGION', 'asia-northeast3')
  vi.stubEnv('GCP_BANK_PDF_JOB', 'bank-pdf')
  vi.stubEnv('GCP_WEEK_PDF_JOB', 'week-pdf')
  vi.stubEnv('GCP_WORKER_SERVICE_ACCOUNT_JSON', JSON.stringify(key))
  vi.stubEnv('GCP_WORKLOAD_IDENTITY_AUDIENCE', '')
  vi.stubEnv('GCP_WORKER_SERVICE_ACCOUNT_EMAIL', '')
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('GCP PDF dispatch', () => {
  function oidcEnv() {
    env()
    vi.stubEnv('GCP_WORKLOAD_IDENTITY_AUDIENCE', '//iam.googleapis.com/projects/123456/locations/global/workloadIdentityPools/vercel/providers/vercel')
    vi.stubEnv('GCP_WORKER_SERVICE_ACCOUNT_EMAIL', 'dispatcher@example.iam.gserviceaccount.com')
    requestHeaders.token = 'request-oidc'
  }
  it('uses a fresh request OIDC token and short-lived impersonation instead of the legacy key', async () => {
    oidcEnv()
    vi.stubEnv('GCP_WORKER_SERVICE_ACCOUNT_JSON', 'invalid-legacy-key')
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'federated' }))
      .mockResolvedValueOnce(Response.json({ accessToken: 'short-lived' })).mockResolvedValueOnce(Response.json({}))
    vi.stubGlobal('fetch', fetcher)
    await dispatchPdfJob('saved-id', 'week_answers')
    expect(fetcher.mock.calls[0][0]).toBe('https://sts.googleapis.com/v1/token')
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ subjectToken: 'request-oidc', subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt' })
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer federated')
    expect(JSON.parse(fetcher.mock.calls[1][1].body).lifetime).toBe('600s')
    expect(fetcher.mock.calls[2][0]).toContain('/jobs/week-pdf:run')
    expect(fetcher.mock.calls[2][1].headers.Authorization).toBe('Bearer short-lived')
  })
  it('fails closed without a request token or with an incomplete federation configuration', async () => {
    oidcEnv()
    requestHeaders.token = null
    vi.stubEnv('VERCEL_OIDC_TOKEN', 'expired-build-token')
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(dispatchPdfJob('id', 'bank_questions')).rejects.toThrow('Vercel OIDC 토큰이 없습니다')
    expect(fetcher).not.toHaveBeenCalled()
    vi.stubEnv('GCP_WORKER_SERVICE_ACCOUNT_EMAIL', '')
    expect(() => gcpWorkerConfig('bank_questions')).toThrow('OIDC 설정이 올바르지 않습니다')
  })
  it('does not expose federation provider errors or tokens', async () => {
    oidcEnv()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret-token-provider-error', { status: 403 })))
    await expect(dispatchPdfJob('id', 'bank_questions')).rejects.toThrow('GCP OIDC 인증 실패 (HTTP 403)')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'federated' }))
      .mockResolvedValueOnce(new Response('secret-error', { status: 403 })))
    await expect(dispatchPdfJob('id', 'bank_questions')).rejects.toThrow('GCP 실행 계정 인증 실패 (HTTP 403)')
  })
  it('signs a limited lifetime assertion for OAuth, without embedding the private key', () => {
    const jwt = createServiceAccountAssertion(key, 1234)
    const [header, payload, signature] = jwt.split('.')
    expect(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.publicKey, Buffer.from(signature, 'base64url'))).toBe(true)
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({ iss: key.client_email, iat: 1234, exp: 4834, aud: 'https://oauth2.googleapis.com/token' })
    expect(jwt).not.toContain('PRIVATE KEY')
  })
  it('selects separate jobs and submits one task with the saved job ID', async () => {
    env()
    expect(gcpWorkerConfig('week_answers').job).toBe('week-pdf')
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token' })))
      .mockResolvedValueOnce(new Response('{}'))
    vi.stubGlobal('fetch', fetcher)
    await dispatchPdfJob('job-id', 'bank_explanation')
    expect(fetcher.mock.calls[1][0]).toBe('https://run.googleapis.com/v2/projects/edunote-test/locations/asia-northeast3/jobs/bank-pdf:run')
    const request = fetcher.mock.calls[1][1]
    expect(JSON.parse(request.body)).toEqual({ overrides: { containerOverrides: [{ env: [{ name: 'PDF_IMPORT_JOB_ID', value: 'job-id' }] }], taskCount: 1 } })
    expect(request.headers.Authorization).toBe('Bearer token')
  })
  it('does not forward GCP error response bodies or malformed secret values to users', async () => {
    env()
    vi.stubEnv('GCP_WORKER_SERVICE_ACCOUNT_JSON', 'secret-key-invalid-json')
    expect(() => gcpWorkerConfig('bank_questions')).toThrow('JSON을 읽지 못했습니다')
    env()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('PRIVATE SECRET', { status: 403 })))
    await expect(dispatchPdfJob('id', 'bank_questions')).rejects.toThrow('GCP 인증 실패 (HTTP 403)')
  })
})
