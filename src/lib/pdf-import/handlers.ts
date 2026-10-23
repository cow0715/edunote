import { saveBankSourceImages } from '../bank-source-images'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseExamBankPageRanged, parsePdfExplanationsHakpyungRanged, parsePdfExplanationsWithClaudeRanged } from '../anthropic'
import { getMegastudyStats } from '../megastudy'
import { mergeExamVocabularyText, syncExamQuestionVocabulary } from '../exam-vocabulary'
import { enrichExamQuestionVocabulary } from '../vocab-enrichment'
import { fetchTeacherTagContext } from '../week-reading-import'
import { createWeekAnswerDraft, currentAnswerKeys, type ReviewFile } from '../week-answer-review-server'
import { checkpointBatchPhase, checkpointCall, reportPdfStage } from './context'

import type { PdfImportJob } from './types'
import { examImportIssues } from './exam-completeness'

export async function runPdfImport(client: SupabaseClient, job: PdfImportJob): Promise<Record<string, unknown>> {
  const { data: teacher, error: teacherError } = await client.from('teacher').select('id').eq('id', job.teacher_id).eq('approval_status', 'approved').single()
  if (teacherError || !teacher) throw new Error('승인된 강사 정보를 찾지 못했습니다.')
  await reportPdfStage('원본 파일을 읽는 중')
  const { data: blob, error } = await client.storage.from('pdf-import-sources').download(job.source_path)
  if (error || !blob) throw new Error('원본 PDF를 읽지 못했습니다.')
  const buffer = await blob.arrayBuffer()
  const base64 = Buffer.from(buffer).toString('base64')
  const mimeType = String(job.payload.mimeType ?? 'application/pdf')
  if (job.kind === 'bank_book') {
    const { importBookPdf } = await import('../book-pdf/worker')
    return importBookPdf(client, job, new Uint8Array(buffer))
  }
  if (job.kind === 'bank_questions') {
    const result = await checkpointBatchPhase({ phase: 'bank-questions-saved-v1', job: job.id },
      () => importBankQuestions(client, job, base64, mimeType))
    if (typeof job.payload.explanationSourcePath === 'string') {
      const { data: explanation, error } = await client.storage.from('pdf-import-sources').download(job.payload.explanationSourcePath)
      if (error || !explanation) throw new Error('문항은 저장됐지만 해설 원본을 읽지 못했습니다.')
      const explanationResult = await importBankExplanation(client, job, await explanation.arrayBuffer())
      const combined = { ...result, explanation_result: explanationResult }
      return { ...combined, exam_incomplete: examImportIssues(combined).length > 0 }
    }
    return { ...result, exam_incomplete: examImportIssues(result).length > 0 }
  }
  if (job.kind === 'bank_explanation') {
    const result = await importBankExplanation(client, job, buffer)
    return { ...result, exam_incomplete: examImportIssues(result).length > 0 }
  }
  return importWeekAnswers(client, job, base64, mimeType)
}

async function importBankQuestions(client: SupabaseClient, job: PdfImportJob, fileData: string, mimeType: string) {
  await reportPdfStage('문항을 추출하는 중')
  const parsed = await parseExamBankPageRanged(fileData, mimeType)
  if (!parsed.items.length && !parsed.issues?.length && !parsed.excludedQuestions?.length) throw new Error('문항을 추출할 수 없습니다. PDF를 확인해주세요.')
  await reportPdfStage('문제은행에 저장하는 중')
  const p = job.payload
  const { error: examError } = await client.from('exam_bank').upsert({
    id: job.target_id, teacher_id: job.teacher_id, title: p.title, exam_year: p.exam_year,
    exam_month: p.exam_month, grade: p.grade, source: p.source || '교육청', form_type: p.form_type || '홀수형',
  }, { onConflict: 'id' })
  if (examError) throw new Error(`자료 저장 실패: ${examError.message}`)
  const rows = parsed.items.map((q) => ({
    exam_bank_id: job.target_id, question_number: q.question_number, question_type: q.question_type,
    passage: q.passage || '', question_text: q.question_text, choices: q.choices || [], answer: q.answer || '', raw_text: '',
  }))
  if (rows.length) {
    const { error } = await client.from('exam_bank_question').upsert(rows, { onConflict: 'exam_bank_id,question_number' })
    if (error) throw new Error(`문항 저장 실패: ${error.message}`)
    await saveBankSourceImages(client, job.target_id, fileData, parsed.items)
  }
  await reportPdfStage('시험 통계를 확인하는 중')
  let statsFetched = 0
  try {
    const stats = await getMegastudyStats(Number(p.grade), Number(p.exam_year), Number(p.exam_month), p.form_type === '짝수형' ? '짝수형' : '홀수형')
    for (const row of stats ?? []) {
      const { error: updateError } = await client.from('exam_bank_question').update({
        answer: row.answer, difficulty: row.difficulty, points: row.points, correct_rate: row.correct_rate, choice_rates: row.choice_rates,
      }).eq('exam_bank_id', job.target_id).eq('question_number', row.question_number)
      if (!updateError) statsFetched++
    }
  } catch { /* Stats are optional, as in the existing upload route. */ }
  return { ok: !parsed.issues?.length, exam_id: job.target_id, question_count: rows.length, skipped_pages: parsed.skippedNumbers, stats_fetched: statsFetched,
    issues: parsed.issues ?? [], excluded_questions: parsed.excludedQuestions ?? [] }
}

async function importBankExplanation(client: SupabaseClient, job: PdfImportJob, buffer: ArrayBuffer) {
  const result = await checkpointBatchPhase({ phase: 'bank-explanations-saved-v1', job: job.id },
    () => saveBankExplanation(client, job, buffer))
  await reportPdfStage('어휘 정보를 보완하는 중')
  const enriched = result.words.length ? await enrichExamQuestionVocabulary(client, { normalizedWords: result.words, limit: 300, batchSize: 40 }) : { candidates: 0, generated: 0, updated: 0 }
  return { exam_id: job.target_id, updated: result.updated, total: result.total, mode: result.mode, skipped_questions: result.skipped_questions, issues: result.issues, enriched }
}

async function saveBankExplanation(client: SupabaseClient, job: PdfImportJob, buffer: ArrayBuffer) {
  const { data: exam } = await client.from('exam_bank').select('id,exam_month').eq('id', job.target_id).eq('teacher_id', job.teacher_id).single()
  if (!exam) throw new Error('시험을 찾을 수 없습니다.')
  const hakpyung = [3, 4, 5, 7, 10].includes(exam.exam_month)
  const { data: questions, error: questionError } = await client.from('exam_bank_question')
    .select('id,question_number,question_type,passage,explanation_vocabulary').eq('exam_bank_id', job.target_id)
  if (questionError) throw new Error(questionError.message)
  const byNumber = new Map((questions ?? []).map((q) => [q.question_number, q]))
  if (!byNumber.size && job.kind === 'bank_explanation') throw new Error('해설을 연결할 기존 문항이 없습니다. 문제지를 먼저 등록해주세요.')
  await reportPdfStage('해설과 어휘를 추출하는 중')
  const options = { expectedNumbers: [...byNumber.keys()].filter((n) => n >= 18 && n <= 45).sort((a, b) => a - b) }
  const parsed = hakpyung ? await parsePdfExplanationsHakpyungRanged(buffer, options) : await parsePdfExplanationsWithClaudeRanged(buffer, options)
  if (!parsed.items.length && !parsed.issues) throw new Error('해설을 추출할 수 없습니다.')
  await reportPdfStage('해설과 어휘를 저장하는 중')
  const words = new Set<string>()
  let updated = 0
  for (const ex of parsed.items) {
    await reportPdfStage('해설과 어휘를 저장하는 중')
    const q = byNumber.get(ex.question_number)
    if (!q) continue
    const vocabulary = ex.vocabulary?.trim()
      ? mergeExamVocabularyText(q.explanation_vocabulary, ex.vocabulary, undefined, q.passage ?? '') || ex.vocabulary : null
    const updates: Record<string, unknown> = {}
    if (ex.intent?.trim()) updates.explanation_intent = ex.intent
    if (ex.translation?.trim()) updates.explanation_translation = ex.translation
    if (ex.solution?.trim()) updates.explanation_solution = ex.solution
    if (vocabulary) updates.explanation_vocabulary = vocabulary
    if (Object.keys(updates).length) {
      const { error } = await client.from('exam_bank_question').update(updates).eq('id', q.id)
      if (error) throw new Error(error.message)
      if (vocabulary) {
        const synced = await syncExamQuestionVocabulary(client, q.id, vocabulary, q.question_type, q.passage)
        for (const word of synced.normalizedWords) words.add(word)
      }
    }
    updated++
  }
  return { updated, total: parsed.items.length, mode: hakpyung ? 'hakpyung' : 'standard', skipped_questions: parsed.skippedNumbers, issues: parsed.issues ?? [], words: [...words] }
}

async function importWeekAnswers(client: SupabaseClient, job: PdfImportJob, fileData: string, mimeType: string) {
  const { data: week } = await client.from('week').select('id,class:class_id(teacher_id)').eq('id', job.target_id).single()
  const owner = week?.class as unknown as { teacher_id?: string } | null
  if (!week || owner?.teacher_id !== job.teacher_id) throw new Error('주차 접근 권한이 없습니다.')
  const { tagCategories } = await fetchTeacherTagContext(client, job.teacher_id)
  const baseQuestions = await checkpointCall({ phase: 'week-review-base-v1' }, () => currentAnswerKeys(client, job.target_id))
  const separate = typeof job.payload.explanationSourcePath === 'string'
  const files: ReviewFile[] = [{ fileData, mimeType, fileName: String(job.payload.fileName ?? '문제지.pdf'),
    role: separate ? 'questions' : 'combined', bucket: 'pdf-import-sources', path: job.source_path }]
  if (separate) {
    const path = String(job.payload.explanationSourcePath)
    const { data, error } = await client.storage.from('pdf-import-sources').download(path)
    if (error || !data) throw new Error('보관한 해설지 원본을 읽지 못했습니다.')
    files.push({ fileData: Buffer.from(await data.arrayBuffer()).toString('base64'), mimeType: 'application/pdf',
      fileName: String(job.payload.explanationFileName ?? '해설지.pdf'), role: 'answers', bucket: 'pdf-import-sources', path })
  }
  await reportPdfStage('정답 근거와 검토 초안을 준비하는 중')
  return createWeekAnswerDraft(client, { teacherId: job.teacher_id, weekId: job.target_id, jobId: job.id,
    files, tags: tagCategories, baseQuestions })
}
