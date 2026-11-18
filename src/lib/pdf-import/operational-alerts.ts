import type { OperationalArea, PdfWorkerFailure, PdfWorkerFailureStage } from '../operational-alerts'
import { captureOperationalFailure, operationalSentryOptions } from '../operational-sentry'
import type { ExamImportIssue } from './exam-completeness'
import type { PdfImportKind, PdfImportStatus } from './types'

function pdfImportAlertArea(kind: PdfImportKind): OperationalArea | undefined {
  if (kind === 'bank_questions') return 'bank-questions-upload'
  if (kind === 'bank_explanation') return 'bank-explanation-upload'
}

export async function reportFinalPdfFailure(
  kind: PdfImportKind,
  status: PdfImportStatus,
  saved: boolean,
  failure: PdfWorkerFailure,
  stage: PdfWorkerFailureStage,
  stages: readonly ExamImportIssue['stage'][] = [],
) {
  const area = pdfImportAlertArea(kind)
  if (!saved || status !== 'failed' || !area || process.env.PDF_WORKER_ALERT_ENV !== 'production' ||
      !process.env.CLOUD_RUN_JOB) return

  const areas = new Set(stages.length ? stages.map(stage =>
    stage === 'explanations' ? 'bank-explanation-upload' as const : 'bank-questions-upload' as const
  ) : [area])
  for (const affectedArea of areas) console.error('[operational-alert]', affectedArea, failure)
  if (!process.env.SENTRY_DSN) return

  try {
    const Sentry = await import('@sentry/node')
    Sentry.init(operationalSentryOptions(process.env.SENTRY_DSN, process.env.SENTRY_RELEASE))
    const taskAttempt = process.env.CLOUD_RUN_TASK_ATTEMPT
    const worker = {
      stage,
      attempt: taskAttempt && /^\d+$/.test(taskAttempt) ? Number(taskAttempt) + 1 : undefined,
      project: process.env.GCP_PROJECT_ID,
      region: process.env.GCP_WORKER_REGION,
      execution: process.env.CLOUD_RUN_EXECUTION,
    }
    await Promise.all([...areas].map(affectedArea => captureOperationalFailure(Sentry, affectedArea, failure, worker)))
  } catch {
    console.error('[operational-alert] worker_sentry_capture_failed')
  }
}
