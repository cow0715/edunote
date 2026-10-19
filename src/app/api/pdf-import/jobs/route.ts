import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { publicPdfJob } from '@/lib/pdf-import/server'
import type { PdfImportJob } from '@/lib/pdf-import/types'

export async function GET(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 403)
  const weekId = new URL(request.url).searchParams.get('weekId')
  let query = supabase.from('pdf_import_job').select('*').eq('teacher_id', teacherId)
  query = weekId ? query.eq('kind', 'week_answers').eq('target_id', weekId) : query.neq('kind', 'week_answers')
  const { data, error } = await query.order('created_at', { ascending: false }).limit(30)
  if (error) return err('작업 목록을 읽지 못했습니다. 워커 DB 마이그레이션을 확인해주세요.', 503)
  return ok((data as PdfImportJob[]).map(publicPdfJob))
}
