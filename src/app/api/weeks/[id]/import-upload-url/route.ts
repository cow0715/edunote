import { assertWeekOwner, getAuth, getTeacherId, err } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 10
const TEMP_BUCKET = 'exam-pdf-temp'

function sanitizeFileName(value: unknown) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : 'upload.pdf'
  return raw
    .replace(/[^\x00-\x7F]/g, '_')
    .replace(/[/\\?%*:|"<>\s]/g, '_')
    .replace(/_+/g, '_')
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await getAuth()
    const { id: weekId } = await params
    if (!user) return err('인증이 필요합니다.', 401)

    const teacherId = await getTeacherId(supabase, user.id)
    if (!teacherId) return err('강사 정보를 찾지 못했습니다.', 404)
    if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한이 없습니다.', 403)

    const body = await request.json().catch(() => ({}))
    const fileName = sanitizeFileName(body?.fileName)
    const path = `week-import/${weekId}/${Date.now()}_${Math.random().toString(36).slice(2)}_${fileName}`

    const serviceClient = createServiceClient()
    const { data, error } = await serviceClient.storage
      .from(TEMP_BUCKET)
      .createSignedUploadUrl(path)

    if (error || !data) {
      return err(`업로드 URL 생성 실패: ${error?.message ?? 'unknown error'}`, 500)
    }

    return Response.json({ uploadUrl: data.signedUrl, path })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return err(`업로드 URL 생성 실패: ${message}`, 500)
  }
}
