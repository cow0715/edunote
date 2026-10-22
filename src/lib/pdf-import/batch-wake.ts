import { createHash } from 'node:crypto'
import { isUuid } from './types'
import { BOOK_BATCH_POLL_SECONDS } from '../book-pdf/batch-policy'

/** Cloud Tasks invokes the Run Jobs API with OAuth. No public callback endpoint,
 * browser session, static dispatch key, or permanently running poller is needed. */
export async function scheduleBookBatchWake(id: string, lease: string, signal: AbortSignal) {
  const project = process.env.GCP_PROJECT_ID, region = process.env.GCP_WORKER_REGION,
    queue = process.env.GCP_BOOK_BATCH_QUEUE, job = process.env.GCP_BANK_PDF_JOB,
    account = process.env.GCP_BOOK_BATCH_DISPATCH_ACCOUNT
  if (!isUuid(id) || !isUuid(lease) || ![project,region,queue,job].every((v) => v && /^[a-z0-9-]+$/.test(v))
    || !account || !new RegExp(`^[a-z0-9-]+@${project}\\.iam\\.gserviceaccount\\.com$`).test(account)) throw new Error('교재 배치 재개용 Cloud Tasks 설정이 없습니다.')
  const auth = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.any([signal,AbortSignal.timeout(10_000)]),
  })
  if (!auth.ok) throw new Error('워커 실행 계정 인증 실패')
  const token = await auth.json() as { access_token: string }
  const parent = `projects/${project}/locations/${region}/queues/${queue}`
  const name = `${parent}/tasks/pdf-batch-${createHash('sha256').update(`${id}:${lease}`).digest('hex')}`
  const resumeAt = new Date(Date.now()+BOOK_BATCH_POLL_SECONDS*1000).toISOString()
  const response = await fetch(`https://cloudtasks.googleapis.com/v2/${parent}/tasks`, {
    method: 'POST', signal: AbortSignal.any([signal,AbortSignal.timeout(15_000)]),
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: { name, scheduleTime: resumeAt, httpRequest: { httpMethod: 'POST',
      url: `https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`,
      headers: { 'Content-Type': 'application/json' },
      oauthToken: { serviceAccountEmail: account, scope: 'https://www.googleapis.com/auth/cloud-platform' },
      body: Buffer.from(JSON.stringify({ overrides: { containerOverrides: [{ env: [{ name: 'PDF_IMPORT_JOB_ID', value: id }] }], taskCount: 1 } })).toString('base64'),
    } } }),
  })
  if (!response.ok && response.status !== 409) throw new Error(`교재 배치 재개 예약 실패 (HTTP ${response.status})`)
  // Same-lease HTTP retries reuse the task name. Across leases, duplicate wakeups
  // remain harmless because job claiming and batch submission are both fenced.
  return resumeAt
}
