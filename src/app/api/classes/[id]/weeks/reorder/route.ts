import { getAuth, err, ok } from '@/lib/api'

// 수업일(start_date) 순서대로 week_number 재할당
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId } = await params

  // 1. start_date 순으로 정렬 (null은 맨 뒤)
  const { data: weeks, error: fetchError } = await supabase
    .from('week')
    .select('id, start_date')
    .eq('class_id', classId)
    .order('start_date', { ascending: true, nullsFirst: false })

  if (fetchError) return err(fetchError.message, 500)
  if (!weeks || weeks.length === 0) return ok({ updated: 0 })

  // 2. 순서대로 week_number 부여
  const updates = weeks.map((w, i) => ({ id: w.id, week_number: i + 1 }))

  const { error: updateError } = await supabase
    .from('week')
    .upsert(updates, { onConflict: 'id' })

  if (updateError) return err(updateError.message, 500)

  return ok({ updated: updates.length })
}
