// ── 진단평가(주차 시험): 해설지·문제지·정오표 파싱 + 서술형 채점 ─────────────

import { GRADING_SYSTEM, GRADING_RULES, PARSE_ANSWER_SHEET_RULES, QUESTION_MARKUP_RULES, SOURCE_IMAGE_FIELD_RULES } from '../prompts'
import {
  buildFileBlock, callClaudeText, MODELS,
  extractJsonArrayCandidate, parseJsonArrayResponse,
} from './client'
import { discoverQuestionNumbers, rangedParseCallIsolated, sliceNumbers, type RangedCallStats, type RangedFile } from './ranged'

export type SubjectiveQuestion = {
  question_number: number
  sub_label: string | null
  correct_answer_text: string
  grading_criteria: string | null
  question_style?: 'subjective' | 'find_error'
}

export type SubjectiveStudentAnswer = {
  week_score_id: string
  exam_question_id: string
  question_number: number
  sub_label: string | null
  student_name: string
  student_answer_text: string
}

export type GradingResult = {
  week_score_id: string
  exam_question_id: string
  is_correct: boolean
  needs_review: boolean
  ai_feedback: string
}

// ── 해설지 파싱 ──────────────────────────────────────────────────────────

export type ParsedAnswer = {
  question_number: number
  sub_label: string | null            // 소문항 레이블 (예: 'a', 'b'), 없으면 null
  question_style: 'objective' | 'subjective' | 'ox' | 'multi_select' | 'find_error'
  question_type: string | null        // 문제 유형명 (예: "빈칸", "순서", "글의 목적 파악")
  correct_answer: number          // 객관식: 1-5, 서술형: 0
  correct_answer_text: string | null  // 서술형 모범답안
  grading_criteria: string | null     // 서술형 채점 기준
  explanation: string | null          // 오답 해설 (SMS 활용)
  question_text: string | null        // 문제 지문/문항 내용 (해설지에 있는 경우)
  question_stem?: string | null
  passage?: string | null
  choices?: string[] | null
  needs_source_image?: boolean
  source_image_reason?: string | null
  source_page?: number | null
  source_bbox?: SourceBBox | null
}

export type SourceBBox = {
  x: number
  y: number
  width: number
  height: number
}

export type TagCategory = { categoryName: string; tags: string[] }

function buildQuestionTypeTagMappingRules(tagCategories: TagCategory[]): string {
  if (tagCategories.length === 0) {
    return '\n- question_type: 문제 유형명을 한국어로 추출하세요. 확실하지 않으면 null.\n'
  }

  return `
━━━ question_type 매핑 규칙 (반드시 준수) ━━━
아래 목록에서 각 문항에 가장 적합한 유형명을 정확히 그대로 선택하세요.
${tagCategories.map((c) => `[${c.categoryName}]: ${c.tags.join(', ')}`).join('\n')}

매핑 판단 기준:
- 문제 제목이나 해설지에 적힌 유형명이 아니라, 해당 문항이 실제로 테스트하는 문법/개념/독해 유형을 기준으로 고르세요.
- 특정 문법 개념을 묻는 경우에는 포괄적인 형식 태그보다 구체적인 문법 태그를 우선하세요.
- 특정 문법/개념을 확정하기 어려운 경우에만 독해 유형(빈칸, 순서, 삽입, 내용 일치 등)을 선택하세요.
- 세부 문항(a, b, c...)은 부모 문항 유형을 그대로 쓰지 말고, 각 세부 문항이 묻는 개념을 개별적으로 판단하세요.
- 목록에 정확히 맞는 것이 없으면 가장 가까운 기존 유형을 선택하세요. 그래도 판단할 수 없으면 null.
- question_type은 반드시 위 목록 중 하나를 정확히 그대로 입력하세요. 목록에 없는 새 유형을 만들지 마세요.
`
}

/** 해설지(통합형) 파싱 프롬프트 — 통짜·범위 분할이 공유한다 (범위 콜 간 바이트 동일해야 캐시 적중) */
function buildAnswerSheetPrompt(tagCategories: TagCategory[]): string {
  const tagListSection = tagCategories.length > 0
    ? `
━━━ question_type 매핑 규칙 (반드시 준수) ━━━
아래 목록에서 각 문항에 가장 적합한 유형을 정확히 그대로 선택하세요:
${tagCategories.map((c) => `[${c.categoryName}]: ${c.tags.join(', ')}`).join('\n')}

매핑 판단 기준:
- 해설지에 적힌 유형명이 아니라, 해당 문항이 실제로 테스트하는 문법/개념이 무엇인지를 기준으로 고를 것
- 예: 해설지에 "어법" 이라고 적혀 있어도, 실제로 가정법을 묻고 있으면 "가정법" 으로 매핑

우선순위 (반드시 준수):
1. explanation 또는 grading_criteria에서 특정 문법 개념이 명시된 경우 → 문법 유형 태그를 최우선으로 선택
   예: 빈칸 형식이어도 "수동태를 쓸 수 없다"는 설명이 있으면 → "수동태"
   예: 빈칸 형식이어도 "every + 단수명사는 단수 취급"이면 → "수의 일치"
2. 특정 문법 개념이 식별되지 않는 경우에만 서술형 유형(빈칸, 영작 등) 선택
   즉, "빈칸", "영작" 등 형식 태그는 문법 개념으로 분류 불가능할 때 최후 수단으로만 사용

- 소문항(a, b, c...)은 부모 문항의 유형을 그대로 쓰지 말고, 각 소문항이 테스트하는 구체적인 문법 포인트를 개별적으로 분석해서 가장 가까운 태그를 선택할 것
  예: 8번이 "어법" 이어도 → 8(a)는 "관계사", 8(b)는 "가정법", 8(c)는 "도치" 로 각각 다르게 매핑 가능
- 목록에 딱 맞는 게 없으면 의미상 가장 가까운 것 선택. 그래도 없으면 null.
- question_type은 반드시 위 목록 중 하나를 정확히 그대로 입력할 것 (목록에 없는 새 유형 생성 금지)
`
    : '\n- question_type: 해설지에 명시된 문제 유형명 한국어 추출. 없으면 null.\n'

  return `첨부된 시험 문서에서 각 문항의 구조·정답·해설을 추출하세요.

━━━ 문서 구성 규칙 ━━━
- 문서는 문항·정답·해설이 섞인 통합형이거나, 앞쪽 시험지 + 뒤쪽 해설지(정오표)가 합쳐진 형태다.
- 시험지부와 해설부가 나뉘어 있으면: 문항 구조(발문·지문·선지)는 시험지부에서, 정답·해설은
  해설부에서 찾아 같은 번호로 조합하라. 문항은 번호로 식별하고,
  한 문항이 여러 페이지에 걸쳐 있으면 내용을 이어붙여라.
- source_page 는 그 문항(발문·지문)이 실린 시험지부 기준 페이지 번호다. 해설부에서만 확인된 문항은 null.

${PARSE_ANSWER_SHEET_RULES}
${tagListSection}
━━━ question_text 서식 보존 규칙 (반드시 준수) ━━━
${QUESTION_MARKUP_RULES}

━━━ 도표·그림 문항 원본 보존 필드 (모든 객체에 포함) ━━━
${SOURCE_IMAGE_FIELD_RULES}

JSON 배열만 출력 (다른 텍스트 없이, 각 객체에 question_stem/passage/choices 와 needs_source_image/source_image_reason/source_page/source_bbox 포함):
[{"question_number":1,"sub_label":null,"question_style":"objective","question_type":"가정법/조동사","correct_answer":3,"correct_answer_text":null,"grading_criteria":null,"explanation":"...","question_text":"다음 글의 빈칸에 들어갈 말로 가장 적절한 것은?\\nThe researcher concluded that the results were inconclusive. ________ further investigation was needed before any definitive claims could be made about the phenomenon.\\n① However\\n② Therefore\\n③ Thus\\n④ Moreover\\n⑤ Nevertheless","question_stem":"다음 글의 빈칸에 들어갈 말로 가장 적절한 것은?","passage":"The researcher concluded that the results were inconclusive. ________ further investigation was needed before any definitive claims could be made about the phenomenon.","choices":["However","Therefore","Thus","Moreover","Nevertheless"]},{"question_number":2,"sub_label":null,"question_style":"multi_select","question_type":"내용 일치","correct_answer":0,"correct_answer_text":"1,3","grading_criteria":null,"explanation":"...","question_text":"윗글의 내용과 일치하는 것을 모두 고르시오.\\nJohn was born in London in 1990. He studied engineering at university and later moved to Seoul for work."},{"question_number":5,"sub_label":"a","question_style":"ox","question_type":"대명사","correct_answer":0,"correct_answer_text":"X (their)","grading_criteria":null,"explanation":"...","question_text":"다음 문장에서 어법상 틀린 것을 고르시오.\\nEach of the students raised their hand."},{"question_number":5,"sub_label":"b","question_style":"ox","question_type":"수의 일치","correct_answer":0,"correct_answer_text":"O","grading_criteria":null,"explanation":"...","question_text":"다음 문장의 어법이 올바른지 판단하시오.\\nThe committee has made its decision."},{"question_number":6,"sub_label":"a","question_style":"ox","question_type":"내용 일치","correct_answer":0,"correct_answer_text":"F","grading_criteria":null,"explanation":"...","question_text":"Choose True or False (T/F) based on the content of the following text.\\nJohn was born in London in 1990. He studied engineering at university and later moved to Seoul for work.\\n(1) John moved to Seoul in 1990 to study engineering.","question_stem":"Choose True or False (T/F) based on the content of the following text.\\n(1) John moved to Seoul in 1990 to study engineering.","passage":"John was born in London in 1990. He studied engineering at university and later moved to Seoul for work.","choices":null},{"question_number":6,"sub_label":"b","question_style":"ox","question_type":"내용 일치","correct_answer":0,"correct_answer_text":"T","grading_criteria":null,"explanation":"...","question_text":"Choose True or False (T/F) based on the content of the following text.\\nJohn was born in London in 1990. He studied engineering at university and later moved to Seoul for work.\\n(2) John studied engineering at university.","question_stem":"Choose True or False (T/F) based on the content of the following text.\\n(2) John studied engineering at university.","passage":null,"choices":null}]`
}

export async function parseAnswerSheet(
  fileData: string,  // base64
  mimeType: string,  // image/jpeg, image/png, application/pdf 등
  tagCategories: TagCategory[] = [],
): Promise<ParsedAnswer[]> {
  const raw = await callClaudeText({
    model: MODELS.parse,
    maxTokens: 16384,
    content: [buildFileBlock(fileData, mimeType), { type: 'text', text: buildAnswerSheetPrompt(tagCategories) }],
  })
  console.log('[parseAnswerSheet] raw response:', raw)

  const parsed = parseJsonArrayResponse<ParsedAnswer>(raw, 'parseAnswerSheet')
  console.log('[parseAnswerSheet] parsed count:', parsed.length, '| question_numbers:', parsed.map(p => `${p.question_number}${p.sub_label ? p.sub_label : ''}`).join(', '))
  return parsed
}

// ── 해설지(통합형) 출력 범위 분할 파싱 ──────────────────────────────────
// 진단평가는 문항 번호를 미리 모른다 — 번호 발견 콜(캐시 예열 겸)이 주 번호 목록을 받아오면
// 그 목록을 슬라이스해 범위 콜을 전부 병렬로 돌린다. 매 콜 문서 전체를 보므로
// 문서 앞의 문항과 뒤의 해설 섹션을 짝짓는 일이 자동이다 (경계 탐지·분할 불필요).

export type AnswerSheetRangedResult = {
  items: ParsedAnswer[]
  calls: RangedCallStats[]
  /** 번호 발견 콜이 찾은 주 문항 번호 (오름차순) */
  discoveredNumbers: number[]
  /** 콘텐츠 필터로 그룹째 skip 된 번호들 — 해당 문항은 결손 */
  skippedNumbers: number[]
}


export async function parseAnswerSheetRanged(
  files: RangedFile[],
  tagCategories: TagCategory[] = [],
): Promise<AnswerSheetRangedResult> {
  // sonnet-5: 4-6 대비 단가 33% 낮고 신세대라 필터 거절이 stop_reason 으로 온다 (2026-08-27 전환)
  const model = MODELS.parse
  const prompt = buildAnswerSheetPrompt(tagCategories)

  const discovery = await discoverQuestionNumbers({
    files, model, prompt, label: 'parseAnswerSheetRanged.discover',
  })
  if (!discovery.numbers.length) {
    throw new Error('문항 번호를 발견하지 못했습니다. 파일을 확인해주세요.')
  }
  console.log('[parseAnswerSheetRanged] 발견 번호:', discovery.numbers.join(', '))

  // 콜당 문항 수는 코어 공통 상수(NUMBERS_PER_RANGE_CALL) — 문항당 1콜 전 병렬.
  // 필터에 걸린 문항은 정확히 그 문항만 결손된다.
  const groups = sliceNumbers(discovery.numbers)
  const parts = await Promise.all(groups.map((numbers) =>
    rangedParseCallIsolated<ParsedAnswer>({
      files, model, maxTokens: 8192,
      prompt, scope: { numbers }, label: 'parseAnswerSheetRanged',
    })))

  const items = parts
    .flatMap((part) => part.items)
    .sort((a, b) => a.question_number - b.question_number
      || (a.sub_label ?? '').localeCompare(b.sub_label ?? ''))
  return {
    items,
    calls: [discovery.stats, ...parts.flatMap((part) => part.calls)],
    discoveredNumbers: discovery.numbers,
    skippedNumbers: parts.flatMap((part) => part.skippedNumbers).sort((a, b) => a - b),
  }
}

// ── 문제지형 (중간·기말 전용 가져오기) ────────────────────────────────────

export type WeekProblemSheetQuestion = {
  question_number: number
  question_type: string | null
  question_style: 'objective' | 'subjective' | 'ox' | 'multi_select'
  passage: string
  question_text: string
  choices: string[]
  needs_source_image?: boolean
  source_image_reason?: string | null
  source_page?: number | null
  source_bbox?: SourceBBox | null
}

const WEEK_PROBLEM_SHEET_PARSE_RULES = `이 PDF는 주차별 설정의 '중간·기말 전용 가져오기'에 업로드하는 영어 시험지입니다.
이 형식은 보통 상단에 문제, 하단에 정답표가 따로 모여 있습니다.
지금 단계에서는 문제 영역만 읽어서 문항 구조만 추출하세요. 하단 정답표는 무시하세요.

출력 필드:
- question_number: 문항 번호
- question_type: 아래 question_type 매핑 규칙을 따라 기존 유형 목록 중 하나를 선택
- question_style: objective | subjective | ox | multi_select
- passage: 지문이 있으면 전체, 없으면 ""
- question_text: 발문 + 보기문장 + 서답형 지시문까지 포함
- choices: 객관식 보기 배열, 없으면 []. 각 선지는 반드시 원문 번호 기호(①, ②, ③, ④, ⑤...)를 포함해 그대로 작성

판단 규칙:
- 1개 정답 객관식은 objective
- O/X 어법 판단, T/F 내용 참·거짓 판단은 ox (시험지 표기를 그대로 따른다)
- 여러 개를 모두 고르는 형식은 multi_select
- 서답형, 영작형, 빈칸 완성형 텍스트 답안은 subjective

중요:
- 문항은 파일에 보이는 순서대로 배열에 담으세요
- 하단 정답표나 해설표는 문항으로 오인하지 마세요
- 정답은 생성하지 마세요
- 문항을 건너뛰지 마세요
- JSON 배열만 출력하세요`

export async function parseWeekProblemSheetPage(
  fileData: string,
  mimeType: string,
  tagCategories: TagCategory[] = [],
): Promise<WeekProblemSheetQuestion[]> {
  const fileContent = buildFileBlock(fileData, mimeType, '지원하지 않는 파일 형식입니다. PDF 또는 이미지만 업로드해주세요.')

  const raw = await callClaudeText({
    model: MODELS.parse,
    maxTokens: 16384,
    content: [fileContent, {
      type: 'text',
      text: `${WEEK_PROBLEM_SHEET_PARSE_RULES}

${buildQuestionTypeTagMappingRules(tagCategories)}

Additional fields for each question:
${QUESTION_MARKUP_RULES}
${SOURCE_IMAGE_FIELD_RULES}`,
    }],
  })
  console.log('[parseWeekProblemSheetPage] raw response length:', raw.length)

  try {
    const parsed = parseJsonArrayResponse<WeekProblemSheetQuestion>(raw, 'parseWeekProblemSheetPage')
    console.log('[parseWeekProblemSheetPage] parsed count:', parsed.length, '| questions:', parsed.map((p) => p.question_number).join(', '))
    return parsed
  } catch (e) {
    const position = typeof e === 'object' && e && 'position' in e ? Number((e as { position?: unknown }).position) : null
    if (position !== null && Number.isFinite(position)) {
      const candidate = extractJsonArrayCandidate(raw)
      console.error(
        '[parseWeekProblemSheetPage] JSON parse failure near:',
        candidate.slice(Math.max(0, position - 160), position + 160),
      )
    }
    console.error('[parseWeekProblemSheetPage] JSON parse 실패:', e)
    throw e
  }
}

// 정오표 전용 파서(parseProblemSheetAnswerKeyFile)는 삭제됨 — 분리형 업로드 제거(2026-08-27)로
// 정오표는 통합 흐름(시험지+정오표 동시 첨부)의 범위 분할 파서가 함께 읽는다.

// ── 서술형 채점 ──────────────────────────────────────────────────────────

// 이 이하면 단일 호출 (전 문항·전 학생 한 번에 → 일관성 최대, 비용 최소)
// 초과하면 문항별 분할 (같은 문항 학생끼리 비교 채점 → 문항 내 일관성 유지)
const SINGLE_CALL_THRESHOLD = 30

// 단일 배치 채점 (내부 전용)
async function gradeSingleBatch(
  questions: SubjectiveQuestion[],
  answers: SubjectiveStudentAnswer[]
): Promise<GradingResult[]> {
  const qLabel = (q: { question_number: number; sub_label: string | null }) =>
    `${q.question_number}번${q.sub_label ? ` (${q.sub_label})` : ''}`

  const hasFindError = questions.some((q) => q.question_style === 'find_error')
  const findErrorRules = hasFindError ? `
━━━ find_error(기호 찾아 고치기) 유형 특별 규칙 ━━━
아래 [find_error] 표시된 문항에만 적용.

1. 모범답안 형식: "번호:수정내용" (예: "1:If human gene editing turns out to be both safe and effective")
   · 번호 = 지문의 ①~⑤ 중 틀린 문장의 기호
   · 수정내용 = 그 문장의 올바른 형태

2. 학생이 쓸 수 있는 형식 (모두 허용):
   (A) "①: turns out" 또는 "1: turns out"
   (B) "① If human gene editing turns out..." (기호 + 전체 문장)
   (C) "turns out" (수정어만, 기호 없음)
   (D) "is turned out → turns out" (before → after)
   (E) "①" 또는 "1" (기호만, 수정 없음) → 오답

3. 같은 question_number 안의 서로 다른 sub_label 답안은 **순서 무관 집합 매칭**:
   · 학생의 17(a)가 모범답안 ⑤와, 17(b)가 모범답안 ①과 매칭되어도 정답 가능
   · 단, 하나의 모범답안은 한 학생 답안에만 매칭 (중복 금지)

4. 매칭 판단 순서:
   · 학생이 기호를 썼으면 → 기호가 모범답안 번호와 일치해야 매칭
     기호 다르면 무조건 오답, feedback: "①번이 정답"
   · 기호 없으면 → 수정어 의미로 매칭 시도
   · 매칭된 후 correction 의미 비교:
     예) 모범답안 "1:turns out" →
       "turns out" / "is turned out → turns out" / "① turns out" / "① If human gene editing turns out to be both safe and effective" 모두 정답
       "was turned out" / "turn out" (시제·수 일치 어긋남) → 오답

5. 오답 feedback 한국어 20자 이내, 구체적으로:
   · "①번이 정답 (②번 선택)"
   · "turns out으로 수정 필요"
   · 빈칸이면 빈 문자열
` : ''

  const prompt = `${GRADING_SYSTEM}
${findErrorRules}
## 문제 정보
${questions.map((q) => `
[${qLabel(q)}]${q.question_style === 'find_error' ? ' [find_error]' : ''}
모범답안: ${q.correct_answer_text}
채점 기준: ${q.grading_criteria ?? '모범답안과 의미 및 문법이 일치하는지 확인'}
`).join('')}

## 학생 답안
${answers.map((a, i) => `
[${i}] 학생: ${a.student_name} / 문항: ${qLabel(a)}
답안: ${a.student_answer_text}
`).join('')}

## 출력 형식 (JSON 배열만 출력, 다른 텍스트 없이)
위 학생 답안 [0]~[${answers.length - 1}] 의 모든 idx 를 각각 정확히 한 번씩 포함할 것 (누락·중복 금지):
[
  {
    "idx": 위 답안의 [숫자],
    "is_correct": true 또는 false,
    "confidence": "high" 또는 "low",
    "feedback": "틀린 경우 구체적 이유 (20자 이내), 맞으면 빈 문자열"
  }
]

${GRADING_RULES}`

  const raw = await callClaudeText({
    model: MODELS.parse,
    maxTokens: 4096,
    temperature: 0,
    content: prompt,
  })

  const parsed = parseJsonArrayResponse<{ idx: number; is_correct: boolean; confidence?: string; feedback: string }>(raw, 'gradeSingleBatch')

  return parsed
    .map((r) => {
      const original = answers[r.idx]
      if (!original) return null
      return {
        week_score_id: original.week_score_id,
        exam_question_id: original.exam_question_id,
        is_correct: r.is_correct,
        needs_review: r.confidence === 'low',
        ai_feedback: r.feedback ?? '',
      }
    })
    .filter((r): r is GradingResult => r !== null)
}

// 공개 API — 적응형 배치 분할 + 부분 실패 허용
// ≤ 30개: 단일 호출 (전 문항·전 학생 → 비용 최소, 교차 비교로 일관성 최대)
// > 30개: 문항별 분할 (같은 문항 학생끼리 한 호출 → 문항 내 일관성 유지, 출력 잘림 방지)
export async function gradeSubjectiveAnswers(
  questions: SubjectiveQuestion[],
  answers: SubjectiveStudentAnswer[]
): Promise<GradingResult[]> {
  if (answers.length === 0) return []

  type Batch = { questions: SubjectiveQuestion[]; answers: SubjectiveStudentAnswer[] }
  const batches: Batch[] = []

  if (answers.length <= SINGLE_CALL_THRESHOLD) {
    // 소규모 — 단일 호출
    batches.push({ questions, answers })
  } else {
    // 대규모 — question_number 기준 분할 (같은 번호의 sub_label a,b,c는 한 배치로 묶음)
    const byQNum = new Map<number, { questions: SubjectiveQuestion[]; answers: SubjectiveStudentAnswer[] }>()
    for (const q of questions) {
      const entry = byQNum.get(q.question_number) ?? { questions: [], answers: [] }
      entry.questions.push(q)
      byQNum.set(q.question_number, entry)
    }
    for (const a of answers) {
      const entry = byQNum.get(a.question_number)
      if (entry) entry.answers.push(a)
    }
    for (const entry of byQNum.values()) {
      if (entry.answers.length > 0) {
        batches.push(entry)
      }
    }
  }

  console.log(`[gradeSubjectiveAnswers] ${answers.length}개 답안 → ${batches.length}개 배치 (threshold=${SINGLE_CALL_THRESHOLD})`)

  // 배치 병렬 처리 (부분 실패 허용)
  const settled = await Promise.allSettled(
    batches.map((b) => gradeSingleBatch(b.questions, b.answers))
  )

  const allResults: GradingResult[] = []
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status === 'fulfilled') {
      allResults.push(...result.value)
    } else {
      // 배치 실패 → needs_review 로 표시 (나머지 배치는 정상 반영)
      console.error(`[gradeSubjectiveAnswers] 배치 ${i} 실패:`, result.reason)
      for (const a of batches[i].answers) {
        allResults.push({
          week_score_id: a.week_score_id,
          exam_question_id: a.exam_question_id,
          is_correct: false,
          needs_review: true,
          ai_feedback: 'AI 채점 실패 — 수동 확인 필요',
        })
      }
    }
  }

  // 모델이 idx 를 빠뜨리면 해당 답안은 grade route 의 초기값(is_correct=false)이
  // 아무 표시 없이 남는다 (운영에서 정답키와 동일한 답이 조용히 오답 처리된 실사례).
  // 응답에 없는 답안을 needs_review 로 마킹해 검토 패널에 드러낸다.
  const covered = new Set(allResults.map((r) => `${r.week_score_id}|${r.exam_question_id}`))
  for (const a of answers) {
    const key = `${a.week_score_id}|${a.exam_question_id}`
    if (covered.has(key)) continue
    covered.add(key)
    console.error(`[gradeSubjectiveAnswers] 응답 누락 idx: ${a.question_number}${a.sub_label ?? ''} (${a.student_name})`)
    allResults.push({
      week_score_id: a.week_score_id,
      exam_question_id: a.exam_question_id,
      is_correct: false,
      needs_review: true,
      ai_feedback: 'AI 응답 누락 — 수동 확인 필요',
    })
  }

  return allResults
}
