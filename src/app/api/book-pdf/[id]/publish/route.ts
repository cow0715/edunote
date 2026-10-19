import { ok, err } from '@/lib/api'
import { ownedBook } from '@/lib/book-pdf/server'
import { publishVerifiedBook } from '@/lib/book-pdf/publish'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await ownedBook((await params).id)
  if (auth.response) return auth.response
  try { return ok({ exam_id: await publishVerifiedBook(createServiceClient(), auth.document!) }) }
  catch (error) { return err(error instanceof Error ? error.message : '자동 검증 결과 등록 실패', 409) }
}
