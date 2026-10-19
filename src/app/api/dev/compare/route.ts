import { err, ok, getAuth, getTeacherId } from '@/lib/api'
import { createLlmExecution } from '@/lib/llm/client'
import { getModelCatalog, estimateLlmCost } from '@/lib/llm/models'
import { parseExamBankPageRanged } from '@/lib/llm/exam-bank'
import { gradeVocabItemsDetailed, parseVocabPdf, type VocabItem } from '@/lib/llm/vocab'
import { fetchTeacherTagContext, parseAnswerSheetDocument } from '@/lib/week-reading-import'
import { VOCAB_GRADING_RULES } from '@/lib/prompts'
import { createHash } from 'node:crypto'
import type { LlmExecution, LlmUsage } from '@/lib/llm/types'
import type { LlmTask } from '@/lib/llm/tasks'

export const maxDuration = 300

const FUNCTION_TASKS = {
  parseAnswerSheet: 'week.parseAnswers',
  parseExamBankPage: 'examBank.parseQuestions',
  parseVocabPdf: 'vocab.parsePdf',
  gradeVocabItems: 'vocab.gradeMeaning',
} satisfies Record<string, LlmTask>

type CompareFunction = keyof typeof FUNCTION_TASKS

function summarizeExecution(execution: LlmExecution) {
  const calls = execution.calls
  const sum = (key: keyof LlmUsage): number | null => {
    if (!calls.length || calls.some((call) => call.usage?.[key] == null)) return null
    return calls.reduce((total, call) => total + call.usage![key]!, 0)
  }
  const costs = calls.map((call) => call.usage ? estimateLlmCost(call.requestedModel, call.usage) : null)
  return {
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    cacheReadTokens: sum('cacheReadTokens'),
    cacheWriteTokens: sum('cacheWriteTokens'),
    cost: costs.length && costs.every((cost) => cost != null)
      ? costs.reduce<number>((total, cost) => total + cost!, 0)
      : null,
    calls,
  }
}

function readVocabItems(value: unknown): VocabItem[] {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (!Array.isArray(parsed) || parsed.some((item: unknown) => {
    if (!item || typeof item !== 'object') return true
    const candidate = item as Record<string, unknown>
    return !Number.isFinite(candidate.number)
      || typeof candidate.english_word !== 'string'
      || (candidate.student_answer !== null && typeof candidate.student_answer !== 'string')
      || (candidate.correct_answer != null && typeof candidate.correct_answer !== 'string')
  })) throw new Error('채점 항목의 번호·단어·학생 답안을 확인해주세요.')
  // 재시험은 모든 number가 0일 수 있다. 고유 번호를 강제하거나 입력 순서를 변경하지 않는다.
  return parsed as VocabItem[]
}

export async function POST(request: Request) {
  const { user, supabase } = await getAuth()
  if (!user) return err('인증 필요', 401)

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return err('입력을 확인해주세요.')
    body = parsed as Record<string, unknown>
  } catch {
    return err('JSON 입력을 확인해주세요.')
  }

  const { fn, model, fileData, mimeType, jsonInput, customRules } = body
  if (typeof fn !== 'string' || !Object.hasOwn(FUNCTION_TASKS, fn)) return err('지원하지 않는 함수')
  if (typeof model !== 'string' || !getModelCatalog().some((candidate) => candidate.id === model)) {
    return err('지원하지 않는 모델')
  }
  if (customRules != null && typeof customRules !== 'string') return err('채점 규칙을 확인해주세요.')

  const functionId = fn as CompareFunction
  const task = FUNCTION_TASKS[functionId]
  const start = Date.now()
  // 비교 요청 하나의 작업만 덮어쓴다. 운영 설정과 다른 요청의 모델 연결은 유지된다.
  const execution = createLlmExecution({ [task]: model })
  let gradingRulesHash: string | null = null

  try {
    let result: unknown
    if (functionId === 'gradeVocabItems') {
      const items = readVocabItems(jsonInput)
      let resolvedRules = customRules as string | undefined
      if (customRules == null) {
        // 운영 채점과 같은 저장된 맞춤 규칙을 읽는다. 비교 실행은 결과를 저장하지 않는다.
        const { data: promptRow } = await supabase.from('prompts').select('content').eq('key', 'vocab_grading_rules').maybeSingle()
        resolvedRules = promptRow?.content ?? undefined
      }
      gradingRulesHash = createHash('sha256').update(resolvedRules ?? VOCAB_GRADING_RULES).digest('hex')
      const detailed = await gradeVocabItemsDetailed(items, resolvedRules, { execution })
      result = detailed.results
    } else {
      if (typeof fileData !== 'string' || !fileData || typeof mimeType !== 'string' || !mimeType) {
        throw new Error('파일 필요')
      }
      switch (functionId) {
        case 'parseAnswerSheet': {
          const teacherId = await getTeacherId(supabase, user.id)
          const { tagCategories } = await fetchTeacherTagContext(supabase, teacherId)
          const parsed = await parseAnswerSheetDocument([{ fileData, mimeType }], tagCategories, { execution })
          result = parsed.answers
          break
        }
        case 'parseExamBankPage': {
          const parsed = await parseExamBankPageRanged(fileData, mimeType, { execution })
          result = parsed.items
          break
        }
        case 'parseVocabPdf':
          result = await parseVocabPdf(fileData, mimeType, { execution })
          break
      }
    }
    return ok({ result, gradingRulesHash, ...summarizeExecution(execution), durationMs: Date.now() - start })
  } catch (error: unknown) {
    // 실패한 호출도 받은 사용량은 비용에 포함한다. 미확인 사용량을 0으로 표시하지 않는다.
    return ok({
      error: error instanceof Error ? error.message : String(error),
      gradingRulesHash,
      ...summarizeExecution(execution),
      durationMs: Date.now() - start,
    })
  }
}
