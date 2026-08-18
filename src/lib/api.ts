import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>
export type TeacherApprovalStatus = 'pending' | 'approved' | 'blocked'

export interface TeacherAccess {
  id: string
  approval_status: TeacherApprovalStatus
  is_admin: boolean
}

/** 에러 응답 */
export function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** 성공 응답 (status 기본 200, 필요 시 201 등 지정) */
export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

/** supabase + user 반환 (인증 실패 시 user = null) */
export async function getAuth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

/** teacher.id 조회 (없으면 null) */
export async function getTeacherId(supabase: SupabaseServerClient, authId: string) {
  const { data } = await supabase
    .from('teacher')
    .select('id')
    .eq('auth_id', authId)
    .eq('approval_status', 'approved')
    .single()
  return data?.id ?? null
}

export async function getTeacherAccess(
  supabase: SupabaseServerClient,
  authId: string
): Promise<TeacherAccess | null> {
  const { data } = await supabase
    .from('teacher')
    .select('id, approval_status, is_admin')
    .eq('auth_id', authId)
    .single()

  return data as TeacherAccess | null
}

/** class가 해당 teacher 소유인지 확인 */
export async function assertClassOwner(supabase: SupabaseServerClient, classId: string, teacherId: string) {
  const { data } = await supabase.from('class').select('id').eq('id', classId).eq('teacher_id', teacherId).single()
  return !!data
}

/** week가 해당 teacher 소유인지 확인 (week → class → teacher_id) */
export async function assertWeekOwner(supabase: SupabaseServerClient, weekId: string, teacherId: string) {
  const { data: week } = await supabase.from('week').select('class_id').eq('id', weekId).single()
  if (!week) return false
  const { data: cls } = await supabase.from('class').select('id').eq('id', week.class_id).eq('teacher_id', teacherId).single()
  return !!cls
}

/**
 * 이 주차에 채점된 단어 답안이 있는지 (개수 반환, 없으면 0).
 * 채점이 시작된 뒤에는 시험지·단어장·예문을 바꾸면 정답 역산이 어긋나므로 잠근다.
 * (2026-08-18 결정: 원본과 답안을 따로 유지하는 대신 아예 막는다. 출제 후 바꾸는 일은 거의 없다.)
 */
export async function countGradedVocabAnswers(supabase: SupabaseServerClient, weekId: string): Promise<number> {
  const { data: scores } = await supabase.from('week_score').select('id').eq('week_id', weekId)
  const scoreIds = (scores ?? []).map((s) => s.id)
  if (scoreIds.length === 0) return 0
  const { count } = await supabase
    .from('student_vocab_answer')
    .select('id', { count: 'exact', head: true })
    .in('week_score_id', scoreIds)
  return count ?? 0
}

export const VOCAB_LOCKED_MESSAGE = (count: number) =>
  `이미 채점된 단어 답안이 ${count}개 있어 바꿀 수 없습니다. 바꾸려면 먼저 이 주차의 단어 채점을 지워야 합니다.`
