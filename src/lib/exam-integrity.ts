// 시험 데이터 정합성 점검 결과를 읽고 사람이 볼 형태로 요약한다.
//
// 판정 규칙은 전부 DB 뷰(exam_integrity_issue)에 있다. 여기서는 "무엇이 얼마나 심각한가" 만 정한다.
//
// 지금은 자동 호출하는 곳이 없다 — 과거 잔재 50건이 매일 로그에 찍혀 새 결함을 묻어버려서
// cleanup cron 에서 뺐다. 뷰와 함수는 DB 에 그대로 있으니 필요할 때 직접 보면 된다:
//   select * from exam_integrity_summary();
//   select * from exam_integrity_issue;
// 다시 자동 감시로 돌리려면 잔재를 정리하거나 기준선(확인 처리)을 먼저 잡아야 한다.

import { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

export type IntegrityCount = { kind: string; count: number }

/**
 * 항목별 성격.
 *   score — 학생 점수·정답률에 직접 영향
 *   data  — 화면·분석 품질 문제 (점수는 그대로)
 */
export const INTEGRITY_SEVERITY: Record<string, 'score' | 'data'> = {
  조합선택형_오분리: 'score',        // 문항이 2개로 세어져 분모가 부푼다
  미작성_정답처리: 'score',
  objective_판정_불일치: 'score',
  점수합_불일치: 'score',
  중복답안: 'score',
  objective_정답키_없음: 'data',
  objective_정답텍스트_혼입: 'data',
  소문항_단독: 'data',
}

export type IntegritySummary = {
  total: number
  /** 점수에 영향이 가는 항목의 합 — 이게 0 이 아니면 우선 대응 대상 */
  scoreAffecting: number
  hasIssue: boolean
  /** 로그 한 줄씩. 심각한 것부터 */
  lines: string[]
}

/** 집계 행을 요약한다 (순수) */
export function summarizeIntegrity(rows: IntegrityCount[]): IntegritySummary {
  const clean = rows.filter((r) => r.count > 0)
  const weight = (kind: string) => (INTEGRITY_SEVERITY[kind] === 'score' ? 0 : 1)
  const sorted = [...clean].sort((a, b) => weight(a.kind) - weight(b.kind) || b.count - a.count)

  return {
    total: clean.reduce((n, r) => n + r.count, 0),
    scoreAffecting: clean
      .filter((r) => INTEGRITY_SEVERITY[r.kind] === 'score')
      .reduce((n, r) => n + r.count, 0),
    hasIssue: clean.length > 0,
    lines: sorted.map((r) => `${INTEGRITY_SEVERITY[r.kind] === 'score' ? '[점수]' : '[데이터]'} ${r.kind}: ${r.count}건`),
  }
}

export type IntegrityCheckResult =
  | { ok: true; summary: IntegritySummary }
  /** 뷰가 없거나 조회 실패 — cleanup 을 멈추지 않는다 */
  | { ok: false; error: string }

/** 정합성 요약을 읽어온다. 실패해도 throw 하지 않는다 */
export async function checkExamIntegrity(supabase: ServiceClient): Promise<IntegrityCheckResult> {
  const { data, error } = await supabase.rpc('exam_integrity_summary')
  if (error) return { ok: false, error: error.message }
  const rows = (data ?? []) as IntegrityCount[]
  return { ok: true, summary: summarizeIntegrity(rows.map((r) => ({ kind: r.kind, count: Number(r.count) }))) }
}
