import { ok, err } from '@/lib/api'
import { ownedBook } from '@/lib/book-pdf/server'
import { createServiceClient } from '@/lib/supabase/service'
import { z } from 'zod'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await ownedBook((await params).id)
  if (auth.response) return auth.response
  const doc = auth.document!
  const { data, error } = await auth.supabase!.from('book_pdf_unit').select('unit_key,unit_order,pages:manifest->pages,questions:manifest->questions,validation,version,verified_version,verification,has_extraction')
    .eq('document_id', doc.id).order('unit_order').limit(2000)
  if (error) return err('검토 목록 조회 실패', 503)
  const { manifest, source_path: _sourcePath, ...rest } = doc
  void _sourcePath
  const units = (data ?? []).map((u) => ({ unit_key: u.unit_key, unit_order: u.unit_order, version: u.version, verified_version: u.verified_version, verification: u.verification,
    validation: u.validation, pages: u.pages, questions: u.questions, has_extraction: u.has_extraction }))
  return ok({ document: { ...rest, manifest: manifest ? { ...manifest, units: undefined, unit_count: manifest.units.length } : null }, units })
}

const metadataSchema = z.object({ title: z.string().trim().min(1).max(300), academic_year: z.number().int().min(1900).max(2200).nullable(), revision: z.number().int().positive(), metadata_reviewed: z.literal(true) })
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await ownedBook((await params).id)
  if (auth.response) return auth.response
  const p = metadataSchema.safeParse(await request.json().catch(() => null))
  if (!p.success) return err('자료명·학년도 확인 값이 올바르지 않습니다.')
  const { data, error } = await createServiceClient().from('book_pdf_document').update({ title: p.data.title,
    academic_year: p.data.academic_year, metadata_reviewed: true, revision: p.data.revision + 1 })
    .eq('id', auth.document!.id).eq('teacher_id', auth.teacherId!).eq('status', 'review').eq('revision', p.data.revision).select('id').maybeSingle()
  if (error || !data) return err('자료 상태가 변경됐습니다. 새로고침해주세요.', 409)
  return ok({ ok: true })
}
