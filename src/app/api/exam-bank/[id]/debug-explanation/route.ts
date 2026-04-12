import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import { parseExplanationPdf } from '@/lib/explanation-parser'

export const maxDuration = 60

// POST { storagePath } — PDF 파싱 결과만 반환 (DB 저장 없음)
// 디버그용: 어떤 텍스트가 추출되는지 확인
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { id } = await params
  const { storagePath } = await request.json()
  if (!storagePath) return err('파일 경로 필요')

  const { data: exam } = await supabase
    .from('exam_bank')
    .select('id')
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .single()
  if (!exam) return err('시험을 찾을 수 없습니다', 404)

  const serviceClient = createServiceClient()
  const { data: fileBlob, error: downloadErr } = await serviceClient.storage
    .from('exam-pdf-temp')
    .download(storagePath)
  if (downloadErr || !fileBlob) return err(`파일 다운로드 실패: ${downloadErr?.message}`)

  void serviceClient.storage.from('exam-pdf-temp').remove([storagePath])

  // Raw 텍스트도 같이 반환
  const { extractText, getDocumentProxy } = await import('unpdf')
  const buffer = await fileBlob.arrayBuffer()
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { text } = await extractText(pdf, { mergePages: true })

  let parsed
  try {
    parsed = await parseExplanationPdf(buffer)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return ok({ error: msg, rawText: (text as string).slice(0, 3000), parsed: [] })
  }

  // 원시 텍스트 앞 3000자 + 파싱 결과 반환
  return ok({
    rawTextPreview: (text as string).slice(0, 3000),
    parsed,
    parsedCount: parsed.length,
  })
}
