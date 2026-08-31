// 학부모 공유 링크(/share/[token])의 접근 규칙.
//
// share_token 은 학생당 하나뿐이고 만료가 없다. 그래서 접근 여부는 토큰이 아니라
// "지금도 우리 학원 학생인가" 로 판정한다 — 퇴원하면 링크가 즉시 죽는다.
//
// 판정 기준은 앱의 다른 곳(학생 목록·모의고사·성적표 발송)과 같다:
//   활성 등록(left_at is null) 이면서, 보관되지 않은 반(archived_at is null) 이 하나라도 있을 것.
//
// 주의: "볼 수 있는가" 는 활성 등록으로 판정하지만, 실제로 보여줄 데이터 범위는
// 퇴원한 반까지 포함한다. 정규반에 다니면서 지난 특강반 기록을 보는 경우가 정상이기 때문.

import { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

export type ShareEnrollment = {
  class_id: string
  joined_at?: string | null
  left_at: string | null
}

/** 403 응답 본문 — 라우트마다 문구가 갈리지 않게 한곳에 둔다 */
export const SHARE_CLOSED_ERROR = '공유가 종료되었습니다'

/**
 * 공유 링크를 열어줄지 판정한다 (순수 함수).
 * @param enrollments 학생의 전체 등록 이력 (퇴원분 포함)
 * @param unarchivedClassIds 보관되지 않은 반 id 목록
 */
export function canViewShare(enrollments: ShareEnrollment[], unarchivedClassIds: Iterable<string>): boolean {
  const open = new Set(unarchivedClassIds)
  return enrollments.some((e) => e.left_at === null && !!e.class_id && open.has(e.class_id))
}

export type ShareAccess = {
  /** 전체 등록 이력 — 지난 기간 조회에 쓰이므로 퇴원분도 그대로 담는다 */
  enrollments: ShareEnrollment[]
  /** 공유 링크를 열어줄지 */
  canView: boolean
}

/** 학생의 등록 이력을 읽고 접근 가능 여부까지 판정한다 */
export async function loadShareAccess(supabase: ServiceClient, studentId: string): Promise<ShareAccess> {
  const { data: rows } = await supabase
    .from('class_student')
    .select('class_id, joined_at, left_at')
    .eq('student_id', studentId)

  const enrollments = (rows ?? []) as ShareEnrollment[]
  const activeClassIds = [...new Set(
    enrollments.filter((e) => e.left_at === null).map((e) => e.class_id).filter(Boolean)
  )]
  if (activeClassIds.length === 0) return { enrollments, canView: false }

  const { data: openClasses } = await supabase
    .from('class')
    .select('id')
    .in('id', activeClassIds)
    .is('archived_at', null)

  return {
    enrollments,
    canView: canViewShare(enrollments, (openClasses ?? []).map((c) => c.id as string)),
  }
}

/** 등록 이력이 필요 없는 라우트용 단축 */
export async function canViewShareByStudentId(supabase: ServiceClient, studentId: string): Promise<boolean> {
  return (await loadShareAccess(supabase, studentId)).canView
}
