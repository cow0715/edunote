import { saveBankSourceImages } from '../bank-source-images'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseExamBankPageRanged, parsePdfExplanationsHakpyungRanged, parsePdfExplanationsWithClaudeRanged } from '../anthropic'
import { getMegastudyStats } from '../megastudy'
import { mergeExamVocabularyText, syncExamQuestionVocabulary } from '../exam-vocabulary'
import { enrichExamQuestionVocabulary } from '../vocab-enrichment'
import { createTagMatcher, fetchTeacherTagContext, parseAnswerSheetDocument, saveWeekAnswerSheetFile, syncWeekReadingQuestionsAndRegrade } from '../week-reading-import'
import { checkpointBatchPhase, checkpointCall, reportPdfStage } from './context'
import { weekImportSnapshot } from './server'
import type { PdfImportJob } from './types'

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
      return { ...result, explanation_result: explanationResult }
    }
    return result
  }
  if (job.kind === 'bank_explanation') return importBankExplanation(client, job, buffer)
  return importWeekAnswers(client, job, base64, mimeType)
}

async function importBankQuestions(client: SupabaseClient, job: PdfImportJob, fileData: string, mimeType: string) {
  await reportPdfStage('문항을 추출하는 중')
  const parsed = await parseExamBankPageRanged(fileData, mimeType)
  if (!parsed.items.length) throw new Error('문항을 추출할 수 없습니다. PDF를 확인해주세요.')
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
  const { error } = await client.from('exam_bank_question').upsert(rows, { onConflict: 'exam_bank_id,question_number' })
  if (error) throw new Error(`문항 저장 실패: ${error.message}`)
  await saveBankSourceImages(client, job.target_id, fileData, parsed.items)
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
  return { ok: true, exam_id: job.target_id, question_count: rows.length, skipped_pages: parsed.skippedNumbers, stats_fetched: statsFetched }
}

async function importBankExplanation(client: SupabaseClient, job: PdfImportJob, buffer: ArrayBuffer) {
  const result = await checkpointBatchPhase({ phase: 'bank-explanations-saved-v1', job: job.id },
    () => saveBankExplanation(client, job, buffer))
  await reportPdfStage('어휘 정보를 보완하는 중')
  const enriched = result.words.length ? await enrichExamQuestionVocabulary(client, { normalizedWords: result.words, limit: 300, batchSize: 40 }) : { candidates: 0, generated: 0, updated: 0 }
  return { updated: result.updated, total: result.total, mode: result.mode, skipped_questions: result.skipped_questions, enriched }
}

async function saveBankExplanation(client: SupabaseClient, job: PdfImportJob, buffer: ArrayBuffer) {
  const { data: exam } = await client.from('exam_bank').select('id,exam_month').eq('id', job.target_id).eq('teacher_id', job.teacher_id).single()
  if (!exam) throw new Error('시험을 찾을 수 없습니다.')
  const hakpyung = [3, 4, 5, 7, 10].includes(exam.exam_month)
  await reportPdfStage('해설과 어휘를 추출하는 중')
  const parsed = hakpyung ? await parsePdfExplanationsHakpyungRanged(buffer) : await parsePdfExplanationsWithClaudeRanged(buffer)
  if (!parsed.items.length) throw new Error('해설을 추출할 수 없습니다.')
  await reportPdfStage('해설과 어휘를 저장하는 중')
  const { data: questions, error: questionError } = await client.from('exam_bank_question')
    .select('id,question_number,question_type,passage,explanation_vocabulary').eq('exam_bank_id', job.target_id)
  if (questionError) throw new Error(questionError.message)
  const byNumber = new Map((questions ?? []).map((q) => [q.question_number, q]))
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
  return { updated, total: parsed.items.length, mode: hakpyung ? 'hakpyung' : 'standard', skipped_questions: parsed.skippedNumbers, words: [...words] }
}

async function importWeekAnswers(client: SupabaseClient, job: PdfImportJob, fileData: string, mimeType: string) {
  const { data: week } = await client.from('week').select('id,class:class_id(teacher_id)').eq('id', job.target_id).single()
  const owner = week?.class as unknown as { teacher_id?: string } | null
  if (!week || owner?.teacher_id !== job.teacher_id) throw new Error('주차 접근 권한이 없습니다.')
  const { tagList, tagCategories } = await fetchTeacherTagContext(client, job.teacher_id)
  // A controlled answer-preserving reparse captures its own pre-parse snapshot.
  // Normal uploads still use the server-authorized registration snapshot.
  const expectedSnapshot = job.payload.preserveExistingAnswers === true
    ? await checkpointCall({ phase: 'preserved-original-snapshot', version: 1 }, () => weekImportSnapshot(client, job.target_id))
    : job.payload.snapshot
  await reportPdfStage('주차 문항과 정답을 추출하는 중')
  const parsed = await parseAnswerSheetDocument([{ fileData, mimeType, fileName: String(job.payload.fileName ?? '') }], tagCategories)
  if (!parsed.answers.length) throw new Error('문항을 찾을 수 없습니다.')
  await reportPdfStage('기존 답안 상태를 확인하는 중')
  // Persist the authorization check before applying; retrying a partial apply must be idempotent.
  await checkpointCall({ phase: 'week-apply-authorized', version: 1 }, async () => {
    if (await weekImportSnapshot(client, job.target_id) !== expectedSnapshot) {
      throw new Error('파싱 중 문항 또는 학생 답안이 변경됐습니다. 최신 상태를 확인한 뒤 다시 등록해주세요.')
    }
    return { allowed: true }
  })
  await reportPdfStage('주차 문항을 저장하고 채점을 갱신하는 중')
  // Use a week-scoped original filename to prevent collisions between teachers.
  await saveWeekAnswerSheetFile(client, job.target_id, fileData, mimeType, `${job.teacher_id}/${job.target_id}/${job.id}.pdf`)
  const result = await syncWeekReadingQuestionsAndRegrade({
    supabase: client, weekId: job.target_id, parsedAnswers: parsed.answers, matchTagId: createTagMatcher(tagList),
    ...(job.payload.preserveExistingAnswers === true ? {
      preserveExistingAnswers: true, deleteMissingQuestions: false, regradeExistingAnswers: false,
    } : {}),
  })
  return { ok: true, ...result, parse_mode_used: 'answer_sheet', skipped_pages: parsed.skipped.map((s) => s.startPage), skipped_questions: parsed.skippedQuestionNumbers ?? [] }
}
