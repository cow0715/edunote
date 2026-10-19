import { ok, err } from '@/lib/api'
import { ownedBook } from '@/lib/book-pdf/server'

export async function GET(_: Request, { params }: { params: Promise<{ id: string; unit: string }> }) {
  const { id, unit } = await params
  const auth = await ownedBook(id)
  if (auth.response) return auth.response
  const { data, error } = await auth.supabase!.from('book_pdf_unit').select('*').eq('document_id', id).eq('unit_key', unit).single()
  if (error || !data) return err('지문 묶음을 찾을 수 없습니다.', 404)
  return ok(data)
}
