export const operationalAreas = {
  'grade-save': '채점 저장',
  'grade-confirm': '서술형 채점 확정',
  'exam-photo': '답안지 사진 저장·판독',
  'exam-photo-job': '답안지 채점 작업 저장',
  'vocab-photo': '단어 시험 사진 채점',
  'bank-questions-upload': '문제지 업로드',
  'bank-explanation-upload': '해설지 업로드',
  'vocab-upload': '단어장 업로드',
  'report-dispatch': '성적표 게시·발송',
  'kakao-delivery': '카카오톡 알림 발송',
  'alert-test': '운영 알림 테스트',
} as const

export type OperationalArea = keyof typeof operationalAreas

export function isOperationalArea(value: unknown): value is OperationalArea {
  return typeof value === 'string' && Object.hasOwn(operationalAreas, value)
}

export function isProductionDeployment() {
  return process.env.VERCEL_ENV === 'production'
}
