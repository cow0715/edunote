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

export const pdfWorkerFailureStages = {
  'prepare': 'PDF 작업 준비 실패',
  'teacher-lookup': '작업 소유자 확인 실패',
  'source-download': '원본 PDF 읽기 실패',
  'question-parse': '문항 추출 실패',
  'question-write': '문제은행 저장 실패',
  'exam-lookup': '해설을 연결할 시험 또는 문항 확인 실패',
  'explanation-parse': '해설·어휘 추출 실패',
  'explanation-write': '해설·어휘 저장 실패',
  'vocab-enrichment': '어휘 정보 보완 실패',
  'batch-processing': 'PDF 배치 처리 실패',
  'quality-check': '자동 복구 후에도 미완료 문항이 남음',
  'progress-write': 'PDF 작업 진행 상태 저장 실패',
  'finish-write': 'PDF 작업 완료 상태 저장 실패',
} as const

export type PdfWorkerFailureStage = keyof typeof pdfWorkerFailureStages
export type PdfWorkerFailure = 'worker-incomplete' | 'worker-batch-stopped' | 'worker-retries-exhausted'

export function isPdfWorkerFailureStage(value: unknown): value is PdfWorkerFailureStage {
  return typeof value === 'string' && Object.hasOwn(pdfWorkerFailureStages, value)
}

export function isPdfWorkerFailure(area: OperationalArea, failure: unknown) {
  return (area === 'bank-questions-upload' || area === 'bank-explanation-upload') &&
    (failure === 'worker-incomplete' || failure === 'worker-batch-stopped' || failure === 'worker-retries-exhausted')
}

export function isOperationalArea(value: unknown): value is OperationalArea {
  return typeof value === 'string' && Object.hasOwn(operationalAreas, value)
}

export function isProductionDeployment() {
  return process.env.VERCEL_ENV === 'production'
}
