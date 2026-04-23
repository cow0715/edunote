import { getAuth, getTeacherId, err, ok } from '@/lib/api'

export async function GET(_: Request, { params }: { params: Promise<{ key: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { key } = await params
  const { data } = await supabase.from('prompts').select('content').eq('key', key).single()

  return ok({ content: data?.content ?? null })
}

export async function PUT(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const { key } = await params
  const { content } = await request.json()
  if (!content) return err('content 필요')

  const { error } = await supabase
    .from('prompts')
    .upsert({ key, content, updated_at: new Date().toISOString() })

  if (error) return err(error.message, 500)
  return ok({ key, content })
}
