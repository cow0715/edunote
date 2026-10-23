import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '../supabase/service'
import { auditExamStorage, type ExamCheckpointText, type StoredExamQuestion } from './exam-storage-audit'
import type { PdfImportJob } from './types'

/** Authenticated routes supply only jobs already selected for this teacher.
 * Checkpoints stay service-only; only derived numbers/reasons leave this module. */
export async function reconcileExamStorage(client: SupabaseClient, teacherId: string, jobs: PdfImportJob[]) {
  const targets = jobs.filter((job) => job.teacher_id === teacherId && ['bank_questions', 'bank_explanation'].includes(job.kind)
    && ['succeeded', 'failed'].includes(job.status))
  if (!targets.length) return jobs
  const ids = [...new Set(targets.map((job) => job.target_id))]
  const checked = new Map<string, PdfImportJob>()
  try {
    // Recheck ownership before using the service client for private checkpoints.
    const banks = await client.from('exam_bank').select('id').eq('teacher_id', teacherId).in('id', ids)
    if (banks.error) throw new Error('bank read')
    const owned = new Set((banks.data ?? []).map((row) => row.id))
    const rows: (StoredExamQuestion & { exam_bank_id: string })[] = []
    const pageSize = 200
    if (owned.size) for (let from = 0; ; from += pageSize) {
      const page = await client.from('exam_bank_question')
        .select('exam_bank_id,question_number,explanation_intent,explanation_translation,explanation_solution,explanation_vocabulary')
        .in('exam_bank_id', [...owned]).order('id').range(from, from + pageSize - 1)
      if (page.error) throw new Error('question read')
      rows.push(...(page.data ?? []))
      if ((page.data?.length ?? 0) < pageSize) break
    }
    const service = createServiceClient()
    // Process one job at a time. Textbook/weekly/vocabulary checkpoints are never fetched.
    for (const job of targets) {
      const entries: ExamCheckpointText[] = []
      for (let from = 0; ; from += pageSize) {
        const page = await service.from('pdf_import_checkpoint')
          .select('task:value->execution->>task,text:value->>text')
          .eq('job_id', job.id).in('value->execution->>task', ['examBank.parseQuestions', 'examBank.extractExplanations'])
          .order('created_at').order('call_key').range(from, from + pageSize - 1)
        if (page.error) throw new Error('checkpoint read')
        for (const value of page.data ?? []) if (typeof value.task === 'string' && typeof value.text === 'string') entries.push({ task: value.task, text: value.text })
        if ((page.data?.length ?? 0) < pageSize) break
      }
      checked.set(job.id, auditExamStorage(job, rows.filter((q) => q.exam_bank_id === job.target_id), entries))
    }
  } catch {
    // Failing open here would repeat the original false completion bug.
    for (const job of targets) checked.set(job.id, { ...job, result: { ...job.result,
      storage_check_error: '현재 저장 문항과 기존 처리 기록을 대조하지 못했습니다. 잠시 후 다시 확인해주세요.' } })
  }
  return jobs.map((job) => checked.get(job.id) ?? job)
}
