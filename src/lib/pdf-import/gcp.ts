import { createSign } from 'node:crypto'
import type { PdfImportKind } from './types'

type ServiceAccount = { client_email: string; private_key: string }

export function gcpWorkerConfig(kind: PdfImportKind) {
  const project = process.env.GCP_PROJECT_ID
  const region = process.env.GCP_WORKER_REGION
  const job = kind === 'week_answers' ? process.env.GCP_WEEK_PDF_JOB : process.env.GCP_BANK_PDF_JOB
  const rawKey = process.env.GCP_WORKER_SERVICE_ACCOUNT_JSON
  const audience = process.env.GCP_WORKLOAD_IDENTITY_AUDIENCE
  const serviceAccount = process.env.GCP_WORKER_SERVICE_ACCOUNT_EMAIL
  if (!project || !region || !job || (!(audience && serviceAccount) && !rawKey)) throw new Error('GCP 워커 설정이 없습니다. 배포 안내를 확인해주세요.')
  if (![project, region, job].every((v) => /^[a-z0-9-]+$/.test(v))) throw new Error('GCP 프로젝트/리전/Job 이름이 올바르지 않습니다.')
  if (audience || serviceAccount) {
    if (!audience || !/^\/\/iam\.googleapis\.com\/projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/.test(audience)
      || !serviceAccount || !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(serviceAccount)) throw new Error('GCP 워커 OIDC 설정이 올바르지 않습니다.')
    return { project, region, job, audience, serviceAccount, key: undefined }
  }
  let key: ServiceAccount
  try { key = JSON.parse(rawKey!) as ServiceAccount } catch {
    throw new Error('GCP 서비스 계정 JSON을 읽지 못했습니다.')
  }
  if (!key || typeof key.client_email !== 'string' || typeof key.private_key !== 'string' || !key.client_email || !key.private_key) throw new Error('GCP 서비스 계정 키 형식이 올바르지 않습니다.')
  return { project, region, job, key, audience: undefined, serviceAccount: undefined }
}

export function createServiceAccountAssertion(key: ServiceAccount, now: number) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: key.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`
  return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url')}`
}

async function workerAccessToken(config: ReturnType<typeof gcpWorkerConfig>) {
  if (config.audience && config.serviceAccount) {
    // Vercel refreshes this header for each request; a build-time env token expires.
    const { headers } = await import('next/headers')
    const oidc = (await headers()).get('x-vercel-oidc-token')
    if (!oidc) throw new Error('Vercel OIDC 토큰이 없습니다. Vercel 운영 배포에서 실행해주세요.')
    const exchanged = await fetch('https://sts.googleapis.com/v1/token', {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audience: config.audience, grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
        requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token', scope: 'https://www.googleapis.com/auth/cloud-platform',
        subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt', subjectToken: oidc }),
    })
    if (!exchanged.ok) throw new Error(`GCP OIDC 인증 실패 (HTTP ${exchanged.status})`)
    const federated = await exchanged.json() as { access_token: string }
    const impersonated = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.serviceAccount}:generateAccessToken`, {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${federated.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/cloud-platform'], lifetime: '600s' }),
    })
    if (!impersonated.ok) throw new Error(`GCP 실행 계정 인증 실패 (HTTP ${impersonated.status})`)
    const token = await impersonated.json() as { accessToken: string }
    return token.accessToken
  }
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: createServiceAccountAssertion(config.key!, Math.floor(Date.now() / 1000)) }),
  })
  if (!tokenResponse.ok) throw new Error(`GCP 인증 실패 (HTTP ${tokenResponse.status})`)
  const token = await tokenResponse.json() as { access_token: string }
  return token.access_token
}

/** Returns after dispatch; never awaits the PDF execution. Uncertain dispatches are safe to retry. */
export async function dispatchPdfJob(id: string, kind: PdfImportKind) {
  const config = gcpWorkerConfig(kind)
  const { project, region, job } = config
  const token = await workerAccessToken(config)
  const response = await fetch(`https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`, {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ overrides: { containerOverrides: [{ env: [{ name: 'PDF_IMPORT_JOB_ID', value: id }] }], taskCount: 1 } }),
  })
  if (!response.ok) throw new Error(`GCP 실행 요청 실패 (HTTP ${response.status})`)
}
