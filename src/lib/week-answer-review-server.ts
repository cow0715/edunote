import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getDocumentProxy, extractText } from 'unpdf'
import { parseAnswerSheetDocument, type ProblemSheetUploadInput } from './week-reading-import'
import type { TagCategory } from './llm/week'
import type { TaskCallOptions } from './llm/client'
import { ANSWER_KEY_COLUMNS, prepareAnswerReview, type ExistingAnswerKey, type ReviewSource } from './week-answer-review'

export type ReviewFile = ProblemSheetUploadInput & { fileData: string; role?: ReviewSource['role']; bucket?: string; path?: string }

export async function parseAnswerSheetReview(files: ReviewFile[], tags: TagCategory[] = [], options: TaskCallOptions = {}) {
  const pages: string[][] = []
  const sources: ReviewSource[] = []
  for (const [index, file] of files.entries()) {
    let text: string[] = []
    if (file.mimeType === 'application/pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(file.fileData, 'base64')))
      try { text = (await extractText(pdf, { mergePages: false })).text } finally { await pdf.destroy() }
    }
    pages.push(text)
    sources.push({ role: file.role ?? (files.length === 1 ? 'combined' : index === 0 ? 'questions' : 'answers'),
      fileName: file.fileName ?? `자료 ${index + 1}`, bucket: file.bucket ?? 'pdf-import-sources', path: file.path ?? '',
      sha256: createHash('sha256').update(Buffer.from(file.fileData, 'base64')).digest('hex'), pageCount: text.length || 1 })
  }
  const parsed = await parseAnswerSheetDocument(files, tags, options)
  return { ...parsed, answers: prepareAnswerReview(parsed.answers, pages, sources), sources }
}

export async function currentAnswerKeys(client: SupabaseClient, weekId: string): Promise<ExistingAnswerKey[]> {
  const { data, error } = await client.from('exam_question').select(ANSWER_KEY_COLUMNS).eq('week_id', weekId).eq('exam_type', 'reading').order('id')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ExistingAnswerKey[]
}

export async function createWeekAnswerDraft(client: SupabaseClient, input: {
  teacherId: string; weekId: string; jobId?: string; files: ReviewFile[]; tags?: TagCategory[]; baseQuestions: ExistingAnswerKey[]; options?: TaskCallOptions
}) {
  if (input.jobId) {
    const previous = await client.from('week_answer_draft').select('id,status').eq('job_id', input.jobId).maybeSingle()
    if (previous.error) throw new Error('정답 검토 기능이 아직 준비되지 않았습니다. 관리자에게 설정 확인을 요청해 주세요.')
    if (previous.data) return { ok: true, draft_id: previous.data.id, needs_review: previous.data.status !== 'confirmed' }
  }
  const result = await parseAnswerSheetReview(input.files, input.tags, input.options)
  const { data, error } = await client.from('week_answer_draft').insert({ teacher_id: input.teacherId, week_id: input.weekId,
    job_id: input.jobId ?? null, sources: result.sources, answers: result.answers, base_questions: input.baseQuestions })
    .select('id').single()
  if (error || !data) throw new Error(`검토 초안 저장 실패: ${error?.message ?? '저장 결과 없음'}`)
  return { ok: true, draft_id: data.id, needs_review: true, questions_parsed: result.answers.length,
    unresolved: result.answers.filter(q => !q.evidence_verified).length, students_regraded: 0, answers_deleted: 0 }
}
