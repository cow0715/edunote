import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import { readVocabSheetName } from '@/lib/anthropic'

export const maxDuration = 30

/**
 * 일괄 사진 채점용 — 시험지 이름란의 손글씨를 읽어 반 학생 중 누구인지 매칭한다.
 * 채점 전에 강사가 확인하는 단계가 있으므로, 확신 없으면 null 로 두고 추측하지 않는다.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

  const { fileData, mimeType } = await request.json() as { fileData?: string; mimeType?: string }
  if (!fileData || !mimeType) return err('필수 파라미터 없음')

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)

  const { data: weekRow } = await supabase.from('week').select('class_id').eq('id', weekId).single()
  if (!weekRow) return err('주차 없음', 404)

  const { data: classStudents } = await supabase
    .from('class_student')
    .select('student_id, student(name)')
    .eq('class_id', weekRow.class_id)
    .is('left_at', null)

  const candidates = (classStudents ?? [])
    .map((cs) => {
      const s = Array.isArray(cs.student) ? cs.student[0] : cs.student
      return { studentId: cs.student_id as string, name: (s as { name?: string } | null)?.name ?? '' }
    })
    .filter((c) => c.name)

  if (candidates.length === 0) return ok({ studentId: null, name: null, confidence: 'none' })

  try {
    const result = await readVocabSheetName(fileData, mimeType, candidates.map((c) => c.name))
    const matched = result.name ? candidates.find((c) => c.name === result.name) : null
    return ok({
      studentId: matched?.studentId ?? null,
      name: result.name,
      rawName: result.rawName,
      confidence: matched ? result.confidence : 'none',
    })
  } catch (e) {
    console.error('[vocab-photo-name] 이름 판독 실패', e)
    return ok({ studentId: null, name: null, confidence: 'none' })
  }
}
