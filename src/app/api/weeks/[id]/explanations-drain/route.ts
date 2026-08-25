import { assertWeekOwner, getAuth, getTeacherId, err, ok } from '@/lib/api'
import { generateMissingReadingExplanations } from '@/lib/reading-explanations'

// AI 해설 드레인: 해설 없는 문항을 요청당 최대 MAX_BATCHES_PER_REQUEST 배치만 생성하고
// remaining 을 돌려준다. 클라이언트가 remaining === 0 이 될 때까지 반복 호출 (300초 천장 회피).
// "해설 없는 문항만" 고르므로 몇 번을 다시 불러도 이미 생성된 해설은 안 건드린다 (멱등).
export const maxDuration = 300

// 6문항 배치 × 동시 2 → 요청당 4배치(24문항) ≈ 2웨이브, 넉넉히 300초 안
const MAX_BATCHES_PER_REQUEST = 4

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await getAuth()
    const { id: weekId } = await params
    if (!user) return err('인증이 필요합니다.', 401)

    const teacherId = await getTeacherId(supabase, user.id)
    if (!teacherId) return err('강사 정보를 찾지 못했습니다.', 404)
    if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한이 없습니다.', 403)

    const result = await generateMissingReadingExplanations(supabase, weekId, {
      maxBatches: MAX_BATCHES_PER_REQUEST,
    })

    return ok({
      generated: result.generated,
      targets: result.targets,
      remaining: result.remaining,
      failed_batches: result.failedBatches,
    })
  } catch (error) {
    console.error('[explanations-drain] unhandled error:', error)
    return err(error instanceof Error ? error.message : '해설 생성에 실패했습니다.', 500)
  }
}
