// ── 진단평가(주차 시험): 해설지·문제지·정오표 파싱 + 서술형 채점 ─────────────

import { GRADING_SYSTEM, GRADING_RULES, PARSE_ANSWER_SHEET_RULES, QUESTION_MARKUP_RULES } from '../prompts'
import {
  buildFileBlock, callClaudeText,
  extractJsonArrayCandidate, parseJsonArrayResponse,
} from './client'

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

export async function parseAnswerSheet(
  fileData: string,  // base64
  mimeType: string,  // image/jpeg, image/png, application/pdf 등
  tagCategories: TagCategory[] = [],
): Promise<ParsedAnswer[]> {
  const fileContent = buildFileBlock(fileData, mimeType)

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

  const prompt = `이 답안해설지에서 각 문항의 정답과 해설을 추출하세요.

${PARSE_ANSWER_SHEET_RULES}
${tagListSection}
━━━ question_text 서식 보존 규칙 (반드시 준수) ━━━
${QUESTION_MARKUP_RULES}

JSON 배열만 출력 (다른 텍스트 없이):
[{"question_number":1,"sub_label":null,"question_style":"objective","question_type":"가정법/조동사","correct_answer":3,"correct_answer_text":null,"grading_criteria":null,"explanation":"...","question_text":"다음 글의 빈칸에 들어갈 말로 가장 적절한 것은?\\nThe researcher concluded that the results were inconclusive. ________ further investigation was needed before any definitive claims could be made about the phenomenon."},{"question_number":2,"sub_label":null,"question_style":"multi_select","question_type":"내용 일치","correct_answer":0,"correct_answer_text":"1,3","grading_criteria":null,"explanation":"...","question_text":"윗글의 내용과 일치하는 것을 모두 고르시오.\\nJohn was born in London in 1990. He studied engineering at university and later moved to Seoul for work."},{"question_number":5,"sub_label":"a","question_style":"ox","question_type":"대명사","correct_answer":0,"correct_answer_text":"X (their)","grading_criteria":null,"explanation":"...","question_text":"다음 문장에서 어법상 틀린 것을 고르시오.\\nEach of the students raised their hand."},{"question_number":5,"sub_label":"b","question_style":"ox","question_type":"수의 일치","correct_answer":0,"correct_answer_text":"O","grading_criteria":null,"explanation":"...","question_text":"다음 문장의 어법이 올바른지 판단하시오.\\nThe committee has made its decision."}]`

  const raw = await callClaudeText({
    model: 'claude-sonnet-4-6',
    maxTokens: 16384,
    content: [fileContent, { type: 'text', text: prompt }],
  })
  console.log('[parseAnswerSheet] raw response:', raw)

  const parsed = parseJsonArrayResponse<ParsedAnswer>(raw, 'parseAnswerSheet')
  console.log('[parseAnswerSheet] parsed count:', parsed.length, '| question_numbers:', parsed.map(p => `${p.question_number}${p.sub_label ? p.sub_label : ''}`).join(', '))
  return parsed
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

export type ProblemSheetAnswerKeyItem = {
  question_number: number
  question_style: 'objective' | 'subjective' | 'ox' | 'multi_select'
  correct_answer: number
  correct_answer_text: string | null
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
- O/X 판단은 ox
- 여러 개를 모두 고르는 형식은 multi_select
- 서답형, 영작형, 빈칸 완성형 텍스트 답안은 subjective

중요:
- 문항은 파일에 보이는 순서대로 배열에 담으세요
- 하단 정답표나 해설표는 문항으로 오인하지 마세요
- 정답은 생성하지 마세요
- 문항을 건너뛰지 마세요
- JSON 배열만 출력하세요`

function buildWeekProblemSheetAnswerVisionPrompt(
  questions: WeekProblemSheetQuestion[],
): string {
  return `이 파일은 영어 시험지의 정오표 또는 정답표입니다.
표, 리스트, 캡처 이미지처럼 생겼더라도 문항 번호별 최종 정답만 읽어 구조화하세요.

문항 목록:
${questions.map((q) => `- ${q.question_number}번 (${q.question_style})${q.choices.length ? ` 보기 ${q.choices.length}개` : ''}`).join('\n')}

출력 필드:
- question_number: 문항 번호
- question_style: objective | subjective | ox | multi_select
- correct_answer: objective면 1~5, 아니면 0
- correct_answer_text:
  * objective면 null
  * ox면 "O" 또는 "X (...)" 형식
  * multi_select면 "1,3" 같은 형식
  * subjective면 정답 텍스트

중요 규칙:
- 첨부한 파일 안에서 보이는 최종 정답만 사용하세요
- 위 문항 목록에 있는 번호만 출력하세요
- 표 머리글, 과목명, 쪽수, 메모는 무시하세요
- objective는 correct_answer에 숫자를 넣고 correct_answer_text는 null로 두세요
- subjective는 correct_answer를 0으로 두고 correct_answer_text에 정답 텍스트를 넣으세요
- 불명확한 문항은 제외하세요
- JSON 배열만 출력하세요`
}

export async function parseWeekProblemSheetPage(
  fileData: string,
  mimeType: string,
  tagCategories: TagCategory[] = [],
): Promise<WeekProblemSheetQuestion[]> {
  const fileContent = buildFileBlock(fileData, mimeType, '지원하지 않는 파일 형식입니다. PDF 또는 이미지만 업로드해주세요.')

  const raw = await callClaudeText({
    model: 'claude-sonnet-4-6',
    maxTokens: 16384,
    content: [fileContent, {
      type: 'text',
      text: `${WEEK_PROBLEM_SHEET_PARSE_RULES}

${buildQuestionTypeTagMappingRules(tagCategories)}

Additional fields for each question:
${QUESTION_MARKUP_RULES}
- needs_source_image: boolean. Use true only when the question contains a table, chart, diagram, picture, schedule grid, map, or complex boxed/multi-column layout that cannot be represented reliably as plain text.
- Do not set needs_source_image true for plain bold text or underlined text when the content can be represented with **text** or <u>text</u>.
- Keep original circled choice markers in choices, such as "① a potential risk..." rather than "a potential risk..." or "1. a potential risk...".
- source_image_reason: one of "table", "chart", "diagram", "layout", "image", or null.
- source_page: page number in the attached file where this question appears. Use 1 for the first page of the attached file.
- source_bbox: normalized bounding box for the full question area on source_page, as {"x":0-1,"y":0-1,"width":0-1,"height":0-1}. Include the question number, passage/table/diagram, and choices. Use null when needs_source_image is false or the area cannot be estimated.
Return these fields in every JSON object.`,
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

export async function parseProblemSheetAnswerKeyFile(
  fileData: string,
  mimeType: string,
  questions: WeekProblemSheetQuestion[],
): Promise<ProblemSheetAnswerKeyItem[]> {
  const fileContent = buildFileBlock(fileData, mimeType, '지원하지 않는 파일 형식입니다. PDF 또는 이미지만 업로드해주세요.')

  const raw = await callClaudeText({
    model: 'claude-sonnet-4-6',
    maxTokens: 8192,
    content: [fileContent, { type: 'text', text: buildWeekProblemSheetAnswerVisionPrompt(questions) }],
  })
  console.log('[parseProblemSheetAnswerKeyFile] raw response length:', raw.length)

  const parsed = parseJsonArrayResponse<ProblemSheetAnswerKeyItem>(raw, 'parseProblemSheetAnswerKeyFile')
  console.log('[parseProblemSheetAnswerKeyFile] parsed count:', parsed.length, '| questions:', parsed.map((p) => p.question_number).join(', '))
  return parsed
}

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
    model: 'claude-sonnet-4-6',
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

  return allResults
}
