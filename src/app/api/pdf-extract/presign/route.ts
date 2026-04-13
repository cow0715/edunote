import { createServiceClient } from '@/lib/supabase/server'
import { err } from '@/lib/api'

export const maxDuration = 10

export async function POST() {
  try {
    const supabase = createServiceClient()
    const path = `temp/${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`

    const { data, error } = await supabase.storage
      .from('pdf-temp')
      .createSignedUploadUrl(path)

    if (error || !data) {
      return err(`업로드 URL 생성 실패: ${error?.message}`, 500)
    }

    return Response.json({ uploadUrl: data.signedUrl, path })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return err(`오류: ${msg}`, 500)
  }
}
