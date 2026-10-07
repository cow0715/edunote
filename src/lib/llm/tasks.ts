import { MODEL_IDS } from './models'

/** Change an individual task's model here; business prompts and limits stay at their call sites. */
const TASK_DEFINITIONS = {
  'vocab.gradeMeaning': { label: '단어 뜻 채점', model: MODEL_IDS.haiku, promptVersion: 'vocab-grade-v1', schemaVersion: 'vocab-grade-v1' },
  'week.gradeSubjective': { label: '서술형 채점', model: MODEL_IDS.sonnet, promptVersion: 'subjective-grade-v1', schemaVersion: 'subjective-grade-v1' },
  'vocab.answerOcr': { label: '단어 답안 판독', model: MODEL_IDS.sonnet, promptVersion: 'vocab-ocr-v1', schemaVersion: 'vocab-ocr-v1' },
  'vocab.sheetName': { label: '단어 시험지 이름 판독', model: MODEL_IDS.haiku, promptVersion: 'vocab-name-v1', schemaVersion: 'vocab-name-v1' },
  'vocab.parsePdf': { label: '단어장 추출', model: MODEL_IDS.sonnet, promptVersion: 'vocab-pdf-v1', schemaVersion: 'vocab-pdf-v1' },
  'vocab.generateExamples': { label: '단어 예문 생성', model: MODEL_IDS.haiku, promptVersion: 'vocab-examples-v1', schemaVersion: 'vocab-examples-v1' },
  'vocab.hint': { label: '단어 힌트 생성', model: MODEL_IDS.haiku, promptVersion: 'vocab-hint-v1', schemaVersion: 'vocab-hint-v1' },
  'vocab.enrich': { label: '어휘 자료 보강', model: MODEL_IDS.haiku, promptVersion: 'vocab-enrich-v1', schemaVersion: 'vocab-enrich-v1' },
  'week.parseAnswers': { label: '진단평가 자료 파싱', model: MODEL_IDS.sonnet, promptVersion: 'week-parse-v1', schemaVersion: 'week-parse-v1' },
  'examBank.parseQuestions': { label: '기출 시험지 파싱', model: MODEL_IDS.sonnet, promptVersion: 'exam-bank-parse-v1', schemaVersion: 'exam-bank-parse-v1' },
  'examBank.extractExplanations': { label: '기출 해설 추출과 보완', model: MODEL_IDS.sonnet, promptVersion: 'exam-bank-explain-v1', schemaVersion: 'exam-bank-explain-v1' },
  'mockExam.parseMetadata': { label: '모의고사 정보 추출', model: MODEL_IDS.sonnet, promptVersion: 'mock-exam-meta-v1', schemaVersion: 'mock-exam-meta-v1' },
  'mockExam.answerOcr': { label: '시험 답안과 OMR 판독', model: MODEL_IDS.sonnet, promptVersion: 'exam-ocr-v1', schemaVersion: 'exam-ocr-v1' },
  'sms.write': { label: '학부모 문자 작성', model: MODEL_IDS.haiku, promptVersion: 'sms-v1', schemaVersion: 'sms-v1' },
  'textCompare.analyze': { label: '시험 변형 분석', model: MODEL_IDS.opus, promptVersion: 'text-compare-v1', schemaVersion: 'text-compare-v1' },
  'pdf.extractText': { label: 'PDF 텍스트 복원', model: MODEL_IDS.sonnet, promptVersion: 'pdf-extract-v1', schemaVersion: 'pdf-extract-v1' },
} as const

export type LlmTask = keyof typeof TASK_DEFINITIONS
export const LLM_CONFIG_VERSION = 'routing-v1'
export const TASK_IDS = Object.freeze(Object.keys(TASK_DEFINITIONS) as LlmTask[])
export function isLlmTask(value: string): value is LlmTask { return Object.hasOwn(TASK_DEFINITIONS, value) }
export function getTask(task: LlmTask) { return TASK_DEFINITIONS[task] }
export function getTaskCatalog() {
  return TASK_IDS.map((id) => Object.freeze({ id, ...TASK_DEFINITIONS[id] }))
}
export function getDefaultTaskBindings(): Record<LlmTask, string> {
  return Object.fromEntries(TASK_IDS.map((task) => [task, TASK_DEFINITIONS[task].model])) as Record<LlmTask, string>
}
