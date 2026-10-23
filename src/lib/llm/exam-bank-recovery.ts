import { buildFileBlock, callLlmTextDetailed, createLlmExecution, isContentFilterError, isJsonParseError, llmCallKey, parseJsonArrayResponse } from './client'
import type { CallLlmOptions, LlmExecution } from './types'
import { PDF_BATCH_REQUEST_ATTEMPTS, PdfBatchRequestFailed, settlePdfBatchCalls } from '../pdf-import/batch-policy'
import { reportPdfStage } from '../pdf-import/context'
import type { ExamImportExclusion, ExamImportIssue } from '../pdf-import/exam-completeness'
import type { RangedFile, RangedCallStats } from './ranged'

type EntryResult<T> = { item?: T; issue?: ExamImportIssue; exclusion?: ExamImportExclusion; calls: RangedCallStats[] }
type Inspection<T> = { item: T } | { exclusion: string } | { reason: string }

/** Only used by exam-bank Batch jobs. Other parsers keep their existing behavior. */
export async function recoverExamEntries<T>(options: {
  files: RangedFile[]; task: 'examBank.parseQuestions' | 'examBank.extractExplanations'
  prompt: string; maxTokens: number; numbers: number[]; execution?: LlmExecution
  inspect: (item: Record<string, unknown>) => Inspection<T>
}) {
  const execution = options.execution ?? createLlmExecution()
  const stage = options.task === 'examBank.parseQuestions' ? 'questions' : 'explanations'
  const files = options.files.map((file) => buildFileBlock(file.fileData, file.mimeType))
  const parts = await settlePdfBatchCalls(options.numbers.map(async (number): Promise<EntryResult<T>> => {
    const scope = `[범위 지시] 이번 호출에서는 다음 번호의 문항만 추출해 출력하세요: ${number}번. 다른 번호의 문항은 절대 출력하지 마세요.`
    const initial: CallLlmOptions = { task: options.task, execution, maxTokens: options.maxTokens,
      content: [...files, { type: 'text', text: options.prompt }, { type: 'text', text: scope }], cacheBoundary: files.length }
    const group = llmCallKey(initial, execution), calls: RangedCallStats[] = []
    let issue: ExamImportIssue = { stage, question_number: number, code: 'missing', reason: '요청한 번호의 결과가 없습니다.', attempts: 0 }
    for (let attempt = 0; attempt < PDF_BATCH_REQUEST_ATTEMPTS; attempt++) {
      const repair = attempt ? `\n[누락 복구 ${attempt}/2] 앞선 결과를 사용하지 말고 원본에서 ${number}번과 공유 지문을 다시 확인하세요. 해당 번호 객체를 빠짐없이 반환하고 JSON 배열만 출력하세요. 원본에 없는 내용은 만들지 마세요.${stage === 'questions' ? '\n도표·그래프라 기존 규칙상 제외하는 경우에만 [{"question_number":' + number + ',"excluded_reason":"chart"}]를 반환하세요. 단순히 찾지 못한 문항을 도표로 분류하지 마세요.' : ''}` : ''
      if (attempt) await reportPdfStage(`${stage === 'questions' ? '문제' : '해설'} ${number}번 누락 복구 중 (${attempt + 1}/3)`)
      issue = { ...issue, attempts: attempt + 1 }
      try {
        const response = await callLlmTextDetailed({ ...initial, batchRetryGroup: group,
          content: [...files, { type: 'text', text: options.prompt }, { type: 'text', text: scope + repair }] })
        calls.push({ ...response.usage, stopReason: response.stopReason, ms: response.execution.durationMs, range: [number, number] })
        if (response.finishReason !== 'complete') {
          issue = { ...issue, code: 'truncated', reason: '출력이 끝까지 완료되지 않았습니다.' }
          continue
        }
        const entries = parseJsonArrayResponse<Record<string, unknown>>(response.text, 'exam-bank-recovery')
        const candidates = entries.filter((entry) => entry && typeof entry === 'object' && Number(entry.question_number) === number)
        if (candidates.length !== 1) {
          issue = { ...issue, code: 'missing', reason: candidates.length ? '같은 번호의 결과가 중복되어 확정할 수 없습니다.' : '응답에 요청한 문항 번호가 없습니다.' }
          continue
        }
        const inspected = options.inspect(candidates[0])
        if ('item' in inspected) return { item: inspected.item, calls }
        if ('exclusion' in inspected) return { exclusion: { question_number: number, reason: inspected.exclusion }, calls }
        issue = { ...issue, code: 'invalid_fields', reason: inspected.reason }
      } catch (error) {
        if (error instanceof PdfBatchRequestFailed) return { issue: { ...issue, code: 'request_failed',
          reason: `${issue.attempts > 1 ? issue.reason + ' ' : ''}${error.message}`, attempts: error.attempts ?? issue.attempts }, calls }
        if (isContentFilterError(error)) issue = { ...issue, code: 'refusal', reason: 'AI가 콘텐츠 필터로 응답을 거절했습니다.' }
        else if (isJsonParseError(error)) issue = { ...issue, code: 'invalid_json', reason: '응답을 JSON 문항 데이터로 읽을 수 없습니다.' }
        else throw error // Batch waiting, uncertain submission, lease loss and infrastructure errors retain their own recovery policy.
      }
    }
    return { issue, calls }
  }))
  return { items: parts.flatMap((part) => part.item ? [part.item] : []), calls: parts.flatMap((part) => part.calls),
    issues: parts.flatMap((part) => part.issue ? [part.issue] : []), excludedQuestions: parts.flatMap((part) => part.exclusion ? [part.exclusion] : []),
    skippedNumbers: parts.flatMap((part) => part.issue ? [part.issue.question_number] : []) }
}
