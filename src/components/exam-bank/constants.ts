// ── 공용 상수 / 유틸 ──────────────────────────────────────────────────────

export const QUESTION_TYPE_LABELS: Record<string, string> = {
  purpose: '글의 목적',
  mood: '심경/분위기',
  claim: '주장',
  implication: '함축 의미',
  topic: '주제',
  title: '제목',
  summary: '요약문',
  blank_vocabulary: '빈칸(어휘)',
  blank_grammar: '빈칸(문법)',
  blank_connective: '빈칸(연결어)',
  blank_phrase: '빈칸(구/절)',
  grammar: '어법',
  vocabulary: '어휘',
  reference: '지칭',
  content_match: '내용 일치',
  notice: '안내문/실용문',
  order: '순서',
  insert: '삽입',
  irrelevant: '무관한 문장',
  long_blank: '장문 빈칸',
  long_order: '장문 순서',
  long_insert: '장문 삽입',
  long_content_match: '장문 내용 일치',
  long_title: '장문 제목/주제',
  other: '기타',
}

// 수능/모의고사 구분 (source 값 → 그룹)
export const EXAM_KIND_OPTIONS = [
  { label: '수능', value: '수능' },
  { label: '모의고사', value: '모의고사' },
]

export const MONTHS = [3, 4, 5, 6, 7, 9, 10, 11]
export const CURRENT_YEAR = new Date().getFullYear()

/** Response가 JSON이 아닐 때도 안전하게 파싱 */
export async function safeJson(res: Response): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const text = await res.text()
  try {
    return { ok: res.ok, data: JSON.parse(text) }
  } catch {
    return { ok: false, data: { error: text.slice(0, 200) || `HTTP ${res.status}` } }
  }
}

const AI_WORK_CONFIRM_MESSAGE = 'AI 작업은 시간이 오래 걸릴 수 있습니다. 실행할까요?'

export function confirmAiWork() {
  return window.confirm(AI_WORK_CONFIRM_MESSAGE)
}

// ── 난이도 색상 ────────────────────────────────────────────────────────────

export const DIFFICULTY_STYLE: Record<string, { bg: string; text: string; dot: string }> = {
  '하':   { bg: 'bg-green-50',  text: 'text-green-700',  dot: 'bg-green-400' },
  '중하': { bg: 'bg-lime-50',   text: 'text-lime-700',   dot: 'bg-lime-400' },
  '중':   { bg: 'bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-400' },
  '중상': { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-400' },
  '상':   { bg: 'bg-rose-50',   text: 'text-rose-600',   dot: 'bg-rose-400' },
  '최상': { bg: 'bg-red-50',    text: 'text-red-600',    dot: 'bg-red-400' },
}

export const DIFFICULTY_OPTIONS = ['하', '중하', '중', '중상', '상', '최상'] as const
export const DIFFICULTY_CRITERIA = [
  ['최상', '30% 미만'],
  ['상', '30~49%'],
  ['중상', '50~59%'],
  ['중', '60~79%'],
  ['중하', '80~89%'],
  ['하', '90~100%'],
] as const
export const DIFFICULTY_CRITERIA_TEXT = `메가스터디 정답률 기준: ${DIFFICULTY_CRITERIA.map(([level, range]) => `${level} ${range}`).join(' · ')}`
