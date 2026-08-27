/**
 * 해설 데이터 공용 타입.
 * 정규식 텍스트 파서(parseExplanationText/parseExplanationPdf)는 삭제됨 (2026-08-27) —
 * EBS 폰트 인코딩 PDF 에서 조용히 깨져 vision 폴백 엔드포인트가 따로 필요했고,
 * 해설 파싱이 vision 출력 범위 분할(llm/exam-bank.ts)로 통일되면서 용도가 사라졌다.
 */

export type ParsedExplanation = {
  question_number: number
  intent: string        // 출제의도
  translation: string   // 해석 (한국어 번역)
  solution: string      // 풀이
  vocabulary: string    // Words & Phrases
}
