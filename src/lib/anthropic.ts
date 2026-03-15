import Anthropic from '@anthropic-ai/sdk'
import { GRADING_SYSTEM, GRADING_RULES, PARSE_ANSWER_SHEET_RULES, SMS_RULES } from './prompts'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export type SubjectiveQuestion = {
  question_number: number
  correct_answer_text: string
  grading_criteria: string | null
}

export type SubjectiveStudentAnswer = {
  week_score_id: string
  exam_question_id: string
  question_number: number
  student_name: string
  student_answer_text: string
}

export type GradingResult = {
  week_score_id: string
  exam_question_id: string
  is_correct: boolean
  ai_feedback: string
}

// ── SMS 생성 ─────────────────────────────────────────────────────────────

export type SmsStudentInput = {
  student_name: string
  vocab: { correct: number; total: number; prev_correct: number | null }
  reading: {
    correct: number
    total: number
    wrong_objective: { question_number: number; concept_category: string; concept_tag: string | null }[]
    wrong_subjective: { question_number: number; concept_category: string; ai_feedback: string }[]
  }
  homework: { done: number; total: number }
  teacher_memo: string | null
  share_url: string
}

export type SmsResult = {
  student_name: string
  message: string
}

export async function generateSmsMessages(
  weekInfo: { week_number: number; class_name: string; start_date?: string | null },
  students: SmsStudentInput[]
): Promise<SmsResult[]> {
  if (students.length === 0) return []

  const dateLabel = weekInfo.start_date
    ? ` (${new Date(weekInfo.start_date).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })})`
    : ''

  const prompt = `당신은 영어 학원 선생님입니다. 학생별 주간 성적 데이터를 보고 학부모에게 보낼 문자를 작성하세요.

[${weekInfo.class_name} ${weekInfo.week_number}주차${dateLabel}]

학생 데이터:
${students.map((s) => {
  const vocabChange = s.vocab.prev_correct !== null
    ? ` (지난주 대비 ${s.vocab.correct - s.vocab.prev_correct >= 0 ? '+' : ''}${s.vocab.correct - s.vocab.prev_correct}개)`
    : ''
  const wrongItems = [
    ...s.reading.wrong_objective.map((w) => `${w.question_number}번 ${w.concept_tag ?? w.concept_category}`),
    ...s.reading.wrong_subjective.map((w) => `${w.question_number}번 ${w.ai_feedback || w.concept_category}`),
  ]
  return `---
학생: ${s.student_name}
단어: ${s.vocab.correct}/${s.vocab.total}${vocabChange}
독해/진단: ${s.reading.correct}/${s.reading.total}${wrongItems.length > 0 ? ` | 틀린문항: ${wrongItems.slice(0, 3).join(', ')}` : ''}
과제: ${s.homework.total > 0 ? `${s.homework.done}/${s.homework.total}` : '완료'}
메모: ${s.teacher_memo ?? '없음'}
링크: ${s.share_url}`
}).join('\n')}

${SMS_RULES}

JSON 배열만 출력 (다른 텍스트 없이):
[{"student_name": "이름", "message": "문자내용"}]`

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = res.content[0].type === 'text' ? res.content[0].text : ''
  let parsed: SmsResult[]
  try {
    parsed = JSON.parse(raw)
  } catch {
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
    parsed = JSON.parse(cleaned)
  }
  return parsed
}

// ── 해설지 파싱 ──────────────────────────────────────────────────────────

export type ParsedAnswer = {
  question_number: number
  question_style: 'objective' | 'subjective'
  question_type: string | null        // 문제 유형명 (예: "빈칸", "순서", "글의 목적 파악")
  correct_answer: number          // 객관식: 1-5, 서술형: 0
  correct_answer_text: string | null  // 서술형 모범답안
  grading_criteria: string | null     // 서술형 채점 기준
  explanation: string | null          // 오답 해설 (SMS 활용)
}

export type TagCategory = { categoryName: string; tags: string[] }

export async function parseAnswerSheet(
  fileData: string,  // base64
  mimeType: string,  // image/jpeg, image/png, application/pdf 등
  tagCategories: TagCategory[] = [],
): Promise<ParsedAnswer[]> {
  const isImage = mimeType.startsWith('image/')
  const isPdf = mimeType === 'application/pdf'

  const fileContent = isImage
    ? { type: 'image' as const, source: { type: 'base64' as const, media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: fileData } }
    : { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: fileData } }

  if (!isImage && !isPdf) throw new Error('지원하지 않는 파일 형식입니다 (PDF 또는 이미지만 가능)')

  const tagListSection = tagCategories.length > 0
    ? `\n아래 유형 목록에서 가장 적합한 것을 정확히 그대로 선택하세요:\n${
        tagCategories.map((c) => `[${c.categoryName}]: ${c.tags.join(', ')}`).join('\n')
      }\nquestion_type은 반드시 위 목록 중 하나를 정확히 그대로 입력하세요. 해당 없으면 null.\n`
    : '\n- question_type: 해설지에 명시된 문제 유형명 한국어 추출. 없으면 null.\n'

  const prompt = `이 답안해설지에서 각 문항의 정답과 해설을 추출하세요.

${PARSE_ANSWER_SHEET_RULES}
${tagListSection}

JSON 배열만 출력 (다른 텍스트 없이):
[{"question_number":1,"question_style":"objective","question_type":"가정법/조동사","correct_answer":3,"correct_answer_text":null,"grading_criteria":null,"explanation":"..."}]`

  const res = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [fileContent, { type: 'text', text: prompt }],
    }],
  })

  const raw = res.content[0].type === 'text' ? res.content[0].text : ''
  let parsed: ParsedAnswer[]
  try {
    parsed = JSON.parse(raw)
  } catch {
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
    parsed = JSON.parse(cleaned)
  }
  return parsed
}

// ── 서술형 채점 ──────────────────────────────────────────────────────────

export async function gradeSubjectiveAnswers(
  questions: SubjectiveQuestion[],
  answers: SubjectiveStudentAnswer[]
): Promise<GradingResult[]> {
  if (answers.length === 0) return []

  const prompt = `${GRADING_SYSTEM}

## 문제 정보
${questions.map((q) => `
[${q.question_number}번]
모범답안: ${q.correct_answer_text}
채점 기준: ${q.grading_criteria ?? '모범답안과 의미 및 문법이 일치하는지 확인'}
`).join('')}

## 학생 답안
${answers.map((a) => `
학생: ${a.student_name} / 문항: ${a.question_number}번
답안: ${a.student_answer_text}
`).join('')}

## 출력 형식 (JSON 배열만 출력, 다른 텍스트 없이)
[
  {
    "student_name": "학생명",
    "question_number": 문항번호,
    "is_correct": true 또는 false,
    "feedback": "틀린 경우 구체적 이유 (20자 이내), 맞으면 빈 문자열"
  }
]

${GRADING_RULES}`

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8096,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : ''

  let parsed: { student_name: string; question_number: number; is_correct: boolean; feedback: string }[]
  try {
    parsed = JSON.parse(raw)
  } catch {
    // JSON 파싱 실패 시 코드블록 제거 후 재시도
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
    parsed = JSON.parse(cleaned)
  }

  // 결과를 week_score_id + exam_question_id 기준으로 매핑
  const answerMap = new Map(
    answers.map((a) => [`${a.student_name}__${a.question_number}`, a])
  )

  return parsed.map((r) => {
    const key = `${r.student_name}__${r.question_number}`
    const original = answerMap.get(key)
    if (!original) return null
    return {
      week_score_id: original.week_score_id,
      exam_question_id: original.exam_question_id,
      is_correct: r.is_correct,
      ai_feedback: r.feedback ?? '',
    }
  }).filter((r): r is GradingResult => r !== null)
}
