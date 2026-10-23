import { checkpointKey, type PdfWorkerContext } from './context'
import type { PdfImportJob } from './types'

/** Preserve already known omissions if a later stage (for example vocabulary) fails. */
export async function savedExamProgress(context: PdfWorkerContext, job: PdfImportJob): Promise<Record<string, unknown> | null> {
  if (!context.batchCall || !['bank_questions', 'bank_explanation'].includes(job.kind)) return null
  const [questions, explanations] = await Promise.all([
    job.kind === 'bank_questions' ? context.read<Record<string, unknown>>(checkpointKey({ phase: 'bank-questions-saved-v1', job: job.id })) : null,
    context.read<Record<string, unknown>>(checkpointKey({ phase: 'bank-explanations-saved-v1', job: job.id })),
  ])
  const result = { ...questions }
  if (explanations) {
    const details = { exam_id: job.target_id, updated: explanations.updated, total: explanations.total, mode: explanations.mode,
      skipped_questions: explanations.skipped_questions, issues: explanations.issues }
    if (job.kind === 'bank_explanation') return details
    result.explanation_result = details
  }
  return Object.keys(result).length ? result : null
}
