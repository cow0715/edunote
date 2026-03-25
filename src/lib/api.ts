import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

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
  const { data } = await supabase.from('teacher').select('id').eq('auth_id', authId).single()
  return data?.id ?? null
}
