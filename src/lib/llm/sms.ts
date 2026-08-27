// ── SMS 생성 ─────────────────────────────────────────────────────────────

import { SMS_RULES } from '../prompts'
import { callClaudeText, MODELS, parseJsonArrayResponse } from './client'

export type SmsStudentInput = {
  student_name: string
  is_absent?: boolean
  is_unexamined?: boolean
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

export async function refineSmsTemplateMessage(
  templateMessage: string,
  rules: string = SMS_RULES,
): Promise<string> {
  const prompt = `다음은 학부모 문자에 들어갈 강사 공통 문구입니다.
학생별 이름, 링크, 인사말, 마무리 상담 문구는 다른 단계에서 자동으로 붙습니다.

아래 문구 자체만 자연스럽게 다듬어 주세요.
- 학생 이름, 학부모님 인사, 날짜, 링크 안내, 상담 안내 문구는 만들지 마세요.
- ◆ 기호를 붙이지 마세요.
- 학생별 점수, 오답, 숙제, raw 데이터는 만들지 마세요.
- 원문의 의미와 말투는 유지하고 어색한 표현만 자연스럽게 정리하세요.
- 결과 문구만 출력하세요.

[문자 작성 기준]
${rules}

[강사 공통 문구]
${templateMessage.trim()}`

  const raw = await callClaudeText({
    model: MODELS.light,
    maxTokens: 1024,
    content: prompt,
  })

  return raw
    .replace(/```(?:text)?\n?|\n?```/g, '')
    .split('\n')
    .map((line) => line.trim().replace(/^◆\s*/, ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function generateSmsMessages(
  weekInfo: { week_number: number; week_label?: string | null; class_name: string; start_date?: string | null },
  students: SmsStudentInput[],
  customPrompt?: string
): Promise<SmsResult[]> {
  if (students.length === 0) return []

  const dateLabel = weekInfo.start_date
    ? ` (${new Date(weekInfo.start_date).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })})`
    : ''

  const prompt = `당신은 영어 학원 선생님입니다. 학생별 주간 성적 데이터를 보고 학부모에게 보낼 문자를 작성하세요.

[${weekInfo.class_name} ${weekInfo.week_label ?? `${weekInfo.week_number}주차`}${dateLabel}]

학생 데이터:
${students.map((s) => {
  const vocabChange = s.vocab.prev_correct !== null
    ? ` (지난주 대비 ${s.vocab.correct - s.vocab.prev_correct >= 0 ? '+' : ''}${s.vocab.correct - s.vocab.prev_correct}개)`
    : ''
  const wrongItems = [
    ...s.reading.wrong_objective.map((w) => `${w.question_number}번 ${w.concept_tag ?? w.concept_category}`),
    ...s.reading.wrong_subjective.map((w) => `${w.question_number}번 ${w.ai_feedback || w.concept_category}`),
  ]
  if (s.is_absent) {
    return `---
학생: ${s.student_name}
결석: 예
링크: ${s.share_url}`
  }
  if (s.is_unexamined) {
    return `---
학생: ${s.student_name}
미응시: 예 (출석했으나 시험 미응시)
링크: ${s.share_url}`
  }
  return `---
학생: ${s.student_name}
단어: ${s.vocab.correct}/${s.vocab.total}${vocabChange}
독해/진단: ${s.reading.correct}/${s.reading.total}${wrongItems.length > 0 ? ` | 틀린문항: ${wrongItems.slice(0, 3).join(', ')}` : ''}
과제: ${s.homework.total > 0 ? `${s.homework.done}/${s.homework.total}` : '완료'}
메모: ${s.teacher_memo ?? '없음'}
링크: ${s.share_url}`
}).join('\n')}

${customPrompt ?? SMS_RULES}

JSON 배열만 출력 (다른 텍스트 없이):
[{"student_name": "이름", "message": "문자내용"}]`

  const raw = await callClaudeText({
    model: MODELS.light,
    maxTokens: 4096,
    content: prompt,
  })
  return parseJsonArrayResponse<SmsResult>(raw, 'generateSmsMessages')
}
