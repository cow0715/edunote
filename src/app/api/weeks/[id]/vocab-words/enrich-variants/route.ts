import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import { enrichVocabVariantMeanings } from '@/lib/vocab-variant-enrichment'

export const maxDuration = 60

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)

  const body = await request.json().catch(() => ({})) as {
    limit?: number
    cacheOnly?: boolean
    variantIds?: string[]
  }

  try {
    const result = await enrichVocabVariantMeanings(supabase, {
      weekId,
      variantIds: Array.isArray(body.variantIds) ? body.variantIds : undefined,
      limit: body.limit,
      cacheOnly: body.cacheOnly,
    })

    return ok({ ok: true, ...result })
  } catch (error) {
    console.error('[enrich-variants] failed', error)
    return err(error instanceof Error ? error.message : '단어 뜻 저장 실패', 500)
  }
}
