import { getAuth, err, ok } from '@/lib/api'

export async function GET(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { searchParams } = new URL(request.url)
  const path = searchParams.get('path')
  if (!path) return err('path 없음')

  const { data, error } = await supabase.storage
    .from('vocab-photos')
    .createSignedUrl(path, 60 * 60) // 1시간 유효

  if (error || !data?.signedUrl) {
    return err(error?.message ?? 'URL 생성 실패', 500)
  }

  return ok({ url: data.signedUrl })
}
