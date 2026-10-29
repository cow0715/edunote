import { err, ok } from '@/lib/api'
import { ownedBook } from '@/lib/book-pdf/server'
import { bookClassificationSchema } from '@/lib/book-pdf/registration-schema'
import { classificationConflict, sourceClassificationConflict } from '@/lib/book-pdf/catalog'
import { createServiceClient } from '@/lib/supabase/service'
import { z } from 'zod'

const schema = bookClassificationSchema.safeExtend({ revision: z.number().int().positive() })
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await ownedBook((await params).id)
  if (auth.response) return auth.response
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err('교재 분류를 확인해주세요.')
  const p = parsed.data, conflict = classificationConflict({ book_code: p.bookCode, academic_year: p.academicYear }, auth.document!.manifest?.printed_years ?? [])
    ?? sourceClassificationConflict({ book_code: p.bookCode, volume: p.volume }, auth.document!.manifest?.units?.flatMap((unit) => unit.questions) ?? [])
  if (conflict) return err(conflict, 422)
  const { data, error } = await createServiceClient().rpc('book_pdf_classify', { p_id: auth.document!.id, p_teacher: auth.teacherId,
    p_revision: p.revision, p_code: p.bookCode, p_year: p.academicYear, p_volume: p.volume })
  if (error || !data) return err(error?.message || '자료 상태가 변경됐습니다. 새로고침해주세요.', 409)
  return ok({ ok: true })
}
