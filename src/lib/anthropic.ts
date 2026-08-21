/**
 * LLM 계층 배럴 (하위 호환용 진입점).
 *
 * 실제 구현은 도메인별로 나뉘어 있다:
 *   llm/client.ts    — Anthropic 클라이언트, 호출/파일블록/JSON 2단 복구 헬퍼
 *   llm/sms.ts       — 학부모 문자 생성·다듬기
 *   llm/vocab.ts     — 단어 시험 (사진 채점 · 이름 판독 · 단어 PDF · 예문 생성)
 *   llm/week.ts      — 진단평가 (해설지/문제지/정오표 파싱 · 서술형 채점)
 *   llm/exam-bank.ts — 기출문제 은행 (시험지 파싱 · 해설 생성/추출)
 *   llm/mock-exam.ts — 모의고사 (메타데이터 파싱 · 답안지/OMR 인식)
 *
 * 새 코드는 필요한 도메인 모듈을 직접 import 해도 되고, 이 배럴을 써도 된다.
 */

export { anthropic } from './llm/client'
export * from './llm/sms'
export * from './llm/vocab'
export * from './llm/week'
export * from './llm/exam-bank'
export * from './llm/mock-exam'
