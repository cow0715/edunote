import { z } from 'zod'

/** Shared wording: keep the existing exam-bank combined extraction call intact. */
export const EXPLANATION_WRITING_RULES = `━━━ solution (풀이) 작성 규칙 ━━━
- 정답 근거: 지문에서 정답의 단서가 되는 핵심 문장/표현을 한국어로 짚어줄 것
- 오답 포인트: 주요 오답 선지가 왜 틀렸는지 구체적으로 설명
- 핵심 어구/구문: 지문의 중요 표현이나 논리 흐름을 추가 설명
- 학생이 다음에 유사 문항을 맞힐 수 있도록 풀이 전략 중심으로, 4~6문장으로 충분히 상세하게

━━━ vocabulary (Words & Phrases) 작성 규칙 ━━━
- 지문에 등장하는 고2~고3 수준의 학습 중요 단어/숙어만 선별, 등장 순서대로
- 형식: "단어 뜻" — 한 줄에 모두 나열 (줄바꿈 없이), 단어 사이 3칸 띄어쓰기
  (예: "eliminate 제거하다   gradual 점진적인   be prone to ~하기 쉽다")
- 포함: 수능/모의고사 빈출 어휘, 고2~3 교과 수준 단어
- 제외: the, is, have 등 기초 어휘 / obscure, ostensible 등 최상위 어휘 (고3 수준 초과)`

export type MaterialSource = { passage: string; translation: string; vocabulary: string;
  questions: { key: string; stem: string; choices: string[]; answer: number; intent: string; solution: string }[] }
export const materialSupplementSchema = z.object({ questions: z.array(z.object({ key: z.string().min(1).max(100),
  solution: z.string().min(1).max(20_000), vocabulary: z.string().max(8_000) }).strict()).min(1).max(20) }).strict()
export type MaterialSupplement = z.infer<typeof materialSupplementSchema>

export function validateMaterialSupplement(source: MaterialSource, value: unknown): MaterialSupplement {
  const result = materialSupplementSchema.parse(value), expected = new Set(source.questions.map((q) => q.key))
  if (result.questions.length !== expected.size || new Set(result.questions.map((q) => q.key)).size !== expected.size
    || result.questions.some((q) => !expected.has(q.key) || !q.solution.trim()
      || /<\/?[a-z][^>]*>/i.test(q.solution + q.vocabulary))) throw new Error('보완 풀이·어휘의 문항 대응 또는 형식이 올바르지 않습니다.')
  return { questions: source.questions.map((q) => result.questions.find((v) => v.key === q.key)!) }
}
