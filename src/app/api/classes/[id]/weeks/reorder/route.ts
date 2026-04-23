import { getAuth, getTeacherId, assertClassOwner, err, ok } from '@/lib/api'

// 수업일(start_date) 순서대로 week_number 재할당
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId } = await params
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertClassOwner(supabase, classId, teacherId)) return err('접근 권한 없음', 403)

  // 1. start_date 순으로 정렬 (null은 맨 뒤)
  const { data: weeks, error: fetchError } = await supabase
    .from('week')
    .select('id, week_number, start_date')
    .eq('class_id', classId)
    .order('start_date', { ascending: true, nullsFirst: false })

  if (fetchError) return err(fetchError.message, 500)
  if (!weeks || weeks.length === 0) return ok({ updated: 0 })

  // 2. 변경이 필요한 주차만 추림
  const needUpdate = weeks
    .map((w, i) => ({ id: w.id, target: i + 1, current: w.week_number as number }))
    .filter((w) => w.current !== w.target)

  if (needUpdate.length === 0) return ok({ updated: 0 })

  // 3. Pass 1: 모두 임시 음수로 (unique(class_id, week_number) 제약 회피)
  for (let i = 0; i < needUpdate.length; i++) {
    const { error } = await supabase
      .from('week')
      .update({ week_number: -(10000 + i) })
      .eq('id', needUpdate[i].id)
    if (error) return err(error.message, 500)
  }

  // 4. Pass 2: 최종 값 할당
  for (const w of needUpdate) {
    const { error } = await supabase
      .from('week')
      .update({ week_number: w.target })
      .eq('id', w.id)
    if (error) return err(error.message, 500)
  }

  return ok({ updated: needUpdate.length })
}
