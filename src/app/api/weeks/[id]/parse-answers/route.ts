import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { assertWeekOwner, getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/service'
import { workerEnabled } from '@/lib/pdf-import/types'
import { registerPdfImport } from '@/lib/pdf-import/server'
import { fetchTeacherTagContext } from '@/lib/week-reading-import'
import { createWeekAnswerDraft, currentAnswerKeys, type ReviewFile } from '@/lib/week-answer-review-server'

export const maxDuration = 300

/** Uploading and reparsing ONLY create review drafts. discardAnswers is ignored:
 * neither this route nor its worker can delete, replace or regrade student work. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await getAuth()
    const { id: weekId } = await params
    if (!user) return err('인증이 필요합니다.', 401)
    const teacherId = await getTeacherId(supabase, user.id)
    if (!teacherId || !await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한이 없습니다.', 403)
    const body = await request.json()
    const uploaded = z.array(z.object({ storagePath: z.string(), fileName: z.string().max(400).optional(), mimeType: z.literal('application/pdf') })).min(1).max(2).parse(body.files ?? [body])
    if (uploaded.length < 1 || uploaded.length > 2) return err('문제지와 해설지 PDF를 최대 2개 선택해 주세요.')
    const prefix = `week-import/${weekId}/`
    if (uploaded.some(f => typeof f.storagePath !== 'string' || !f.storagePath.startsWith(prefix) || f.storagePath.includes('..') || f.mimeType !== 'application/pdf')) return err('업로드 파일 경로가 올바르지 않습니다.')
    if (new Set(uploaded.map(f => f.storagePath)).size !== uploaded.length) return err('같은 파일을 중복 선택할 수 없습니다.')
    const client = createServiceClient()
    const ready = await client.from('week_answer_draft').select('id').eq('week_id', weekId).limit(1)
    if (ready.error) return err('정답 검토 기능이 아직 준비되지 않았습니다. 관리자에게 설정 확인을 요청해 주세요.', 503)
    const baseQuestions = await currentAnswerKeys(client, weekId)
    if (workerEnabled()) {
      if (process.env.WEEK_ANSWER_REVIEW_WORKER_READY !== 'true') return err('정답 검토 워커 업데이트를 준비 중입니다. 기존 정답과 학생 답안은 변경되지 않았습니다.', 503)
      const job = await registerPdfImport({ kind: 'week_answers', teacherId, authId: user.id, targetId: weekId,
        storagePath: uploaded[0].storagePath, explanationStoragePath: uploaded[1]?.storagePath,
        payload: { mimeType: 'application/pdf', fileName: String(uploaded[0].fileName ?? ''),
          explanationFileName: uploaded[1]?.fileName ?? null, baseQuestions, reviewVersion: 1 } })
      return ok(job, { status: 202 })
    }
    const files: ReviewFile[] = []
    const batch = randomUUID()
    for (const [i, file] of uploaded.entries()) {
      const path = `${teacherId}/${batch}-${i}.pdf`
      const copied = await client.storage.from('exam-pdf-temp').copy(file.storagePath, path, { destinationBucket: 'pdf-import-sources' })
      if (copied.error) throw new Error(`원본 보관 실패: ${copied.error.message}`)
      const { data, error } = await client.storage.from('pdf-import-sources').download(path)
      if (error || !data) throw new Error('보관한 원본 PDF를 읽지 못했습니다.')
      files.push({ fileData: Buffer.from(await data.arrayBuffer()).toString('base64'), mimeType: 'application/pdf',
        fileName: String(file.fileName ?? `자료 ${i + 1}`), role: uploaded.length === 1 ? 'combined' : i === 0 ? 'questions' : 'answers',
        bucket: 'pdf-import-sources', path })
    }
    const { tagCategories } = await fetchTeacherTagContext(client, teacherId)
    return ok(await createWeekAnswerDraft(client, { teacherId, weekId, files, baseQuestions, tags: tagCategories }))
  } catch (error) {
    return err(error instanceof Error ? error.message : '검토 초안을 만들지 못했습니다.', 422)
  }
}
