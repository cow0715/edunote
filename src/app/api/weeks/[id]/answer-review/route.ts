import { createHash } from 'node:crypto'
import { assertWeekOwner, getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/service'
import { createTagMatcher, fetchTeacherTagContext, renderPdfPageToPng } from '@/lib/week-reading-import'
import { resolveAnswerReview, type AnswerDraft } from '@/lib/week-answer-review'

async function owner(weekId: string) {
  const { supabase, user } = await getAuth()
  if (!user) return null
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId || !await assertWeekOwner(supabase, weekId, teacherId)) return null
  return { teacherId, userId: user.id, client: createServiceClient() }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: weekId } = await params
  const auth = await owner(weekId)
  if (!auth) return err('접근 권한이 없습니다.', 403)
  const url = new URL(request.url)
  const draftId = url.searchParams.get('draft')
  if (draftId && url.searchParams.has('source')) {
    const { data, error } = await auth.client.from('week_answer_draft').select('sources').eq('id', draftId).eq('week_id', weekId).eq('teacher_id', auth.teacherId).single()
    if (error || !data) return err('자료를 찾지 못했습니다.', 404)
    const i = Number(url.searchParams.get('source'))
    const source = Number.isInteger(i) && i >= 0 ? data.sources?.[i] : null
    if (!source || source.bucket !== 'pdf-import-sources' || !source.path.startsWith(`${auth.teacherId}/`)) return err('자료를 찾지 못했습니다.', 404)
    const page = Number(url.searchParams.get('page'))
    if (url.searchParams.get('view') === 'page') {
      if (!Number.isInteger(page) || page < 1 || page > source.pageCount) return err('원문 페이지를 확인해 주세요.', 400)
      try {
        const file = await auth.client.storage.from(source.bucket).download(source.path)
        if (file.error || !file.data) return err('원본 PDF를 불러오지 못했습니다.', 503)
        const rendered = await renderPdfPageToPng(Buffer.from(await file.data.arrayBuffer()).toString('base64'), page)
        return new Response(new Uint8Array(rendered.buffer), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
      } catch { return err('원문 페이지를 표시하지 못했습니다. 원본 PDF를 새 탭에서 열어 주세요.', 503) }
    }
    const result = await auth.client.storage.from(source.bucket).createSignedUrl(source.path, 600)
    return result.error ? err('원본 링크 생성 실패', 503) : Response.redirect(result.data.signedUrl + (Number.isInteger(page) && page > 0 && page <= source.pageCount ? `#page=${page}` : ''))
  }
  const { data, error } = await auth.client.from('week_answer_draft').select('*').eq('week_id', weekId).eq('teacher_id', auth.teacherId).order('created_at', { ascending: false }).limit(5)
  if (error) return err('정답 검토 기능이 아직 준비되지 않았습니다. 관리자에게 설정 확인을 요청해 주세요.', 503)
  return ok(data)
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: weekId } = await params
    const auth = await owner(weekId)
    if (!auth) return err('접근 권한이 없습니다.', 403)
    const body = await request.json()
    const { data, error } = await auth.client.from('week_answer_draft').select('*').eq('id', body.draft_id).eq('teacher_id', auth.teacherId).eq('week_id', weekId).single()
    if (error || !data) return err('검토 초안을 찾지 못했습니다.', 404)
    if (data.status === 'confirmed') return ok({ ok: true, already_confirmed: true })
    const reviewed = resolveAnswerReview(data as AnswerDraft, body.actions)
    const { tagList } = await fetchTeacherTagContext(auth.client, auth.teacherId)
    const match = createTagMatcher(tagList)
    const answers = reviewed.map(q => ({ ...q, concept_tag_id: match(q.question_type, q.question_style) }))
    // Keep the existing original-PDF APIs working for newly confirmed exams.
    // This is an immutable copy; existing exam originals are never replaced.
    if (data.base_questions.length === 0) {
      const source = data.sources[0]
      if (!source || source.bucket !== 'pdf-import-sources' || !source.path.startsWith(`${auth.teacherId}/`)) throw new Error('보관한 원본 자료를 확인하지 못했습니다.')
      const destination = `${weekId}/${data.id}-source.pdf`
      const copied = await auth.client.storage.from(source.bucket).copy(source.path, destination, { destinationBucket: 'answer-sheets' })
      if (copied.error) {
        const existing = await auth.client.storage.from('answer-sheets').download(destination)
        const hash = existing.data ? createHash('sha256').update(Buffer.from(await existing.data.arrayBuffer())).digest('hex') : null
        if (hash !== source.sha256) throw new Error('확정할 원본 PDF 보관에 실패했습니다. 기존 정답은 변경되지 않았습니다.')
      }
    }
    const result = await auth.client.rpc('confirm_week_answer_draft', { p_id: data.id, p_teacher_id: auth.teacherId, p_auth_id: auth.userId, p_answers: answers })
    if (result.error) return err(result.error.message, 409)
    return ok(result.data)
  } catch (error) {
    return err(error instanceof Error ? error.message : '검토 내용을 확인해 주세요.', 400)
  }
}
