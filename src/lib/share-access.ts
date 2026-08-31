// 학부모 공유 링크(/share/[token])의 접근 규칙.
//
// 두 겹으로 막는다:
//   1. 토큰 해석 — 현재 토큰이거나, 회전 후 유예 기간이 남은 직전 토큰이어야 한다.
//   2. 재학 여부 — 퇴원하면 토큰이 살아 있어도 즉시 닫힌다.
//
// 재학 판정 기준은 앱의 다른 곳(학생 목록·모의고사·성적표 발송)과 같다:
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

/** 응답 문구 — 라우트마다 갈리지 않게 한곳에 둔다 */
export const SHARE_CLOSED_ERROR = '공유가 종료되었습니다'
export const SHARE_EXPIRED_ERROR = '링크가 만료되었습니다'
export const SHARE_NOT_FOUND_ERROR = '학생을 찾을 수 없습니다'

// 회전 정책(언제 돌릴지 · 얼마나 유예할지)은 여기에 모아둔다.
// SQL 쪽 기본값(28)은 손으로 select rotate_share_tokens() 할 때를 위한 것이고,
// 앱은 항상 명시적으로 넘긴다 — PostgREST 는 인자를 생략하면 무인자 함수를 찾기 때문.

/** 회전하는 달 (KST). 학기 중인 달로 골랐다 — 새 링크가 주차 SMS 를 타고 나가야 해서 */
export const ROTATION_MONTHS = [3, 6, 9, 12]

/** 회전 후 옛 링크를 며칠 더 살려둘지. 마이그레이션의 기본값과 같아야 한다 */
export const ROTATION_GRACE_DAYS = 28

/**
 * 오늘이 회전일인지 (KST 기준 분기 첫날).
 *
 * cron 표현식에 분기를 적지 않고 매일 호출해서 여기서 거른다.
 * Vercel Hobby 는 하루 1회 스케줄만 허용하는데, 이렇게 하면 플랜과 무관하게 동작한다.
 * 실수로 하루에 두 번 불려도 rotate_share_tokens 가 유예 중인 학생을 건너뛰므로 안전하다.
 */
export function isRotationDue(now: Date): boolean {
  // 서버 타임존에 기대지 않고 UTC+9 를 직접 더한다
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return ROTATION_MONTHS.includes(kst.getUTCMonth() + 1) && kst.getUTCDate() === 1
}

// ── 토큰 해석 ───────────────────────────────────────────────────────────────

export type ShareTokenResult<T> =
  | { status: 'ok'; student: T; viaPreviousToken: boolean }
  /** 직전 토큰이 맞지만 유예 기간이 지났다 — 404 와 구분해 안내 문구를 다르게 준다 */
  | { status: 'expired' }
  | { status: 'not_found' }

/**
 * 공유 토큰으로 학생을 찾는다.
 * 현재 토큰 → (없으면) 유예 중인 직전 토큰 → (없으면) 만료/미존재 순으로 판정한다.
 *
 * @param columns select 절. 호출부가 필요한 만큼만 가져간다
 */
export async function resolveShareToken<T>(
  supabase: ServiceClient,
  token: string,
  columns: string,
): Promise<ShareTokenResult<T>> {
  // 흔한 경로 — 현재 토큰이면 쿼리 한 번으로 끝난다.
  // share_token 이 uuid 라 토큰이 uuid 형식이 아니면 여기서 에러가 나는데,
  // 그 경우도 data 가 비므로 아래 분기가 그대로 처리한다.
  const current = await supabase
    .from('student')
    .select(columns)
    .eq('share_token', token)
    .maybeSingle()
  if (current.data) return { status: 'ok', student: current.data as unknown as T, viaPreviousToken: false }

  const graced = await supabase
    .from('student')
    .select(columns)
    .eq('previous_share_token', token)
    .gt('previous_share_token_expires_at', new Date().toISOString())
    .maybeSingle()
  if (graced.data) return { status: 'ok', student: graced.data as unknown as T, viaPreviousToken: true }

  // 직전 토큰이긴 한데 유예가 끝난 경우 — "없는 링크" 가 아니라 "만료된 링크" 로 알려준다
  const stale = await supabase
    .from('student')
    .select('id')
    .eq('previous_share_token', token)
    .maybeSingle()
  return stale.data ? { status: 'expired' } : { status: 'not_found' }
}

// ── 재학 여부 ───────────────────────────────────────────────────────────────

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
