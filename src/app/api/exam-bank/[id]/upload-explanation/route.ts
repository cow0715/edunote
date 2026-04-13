import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import { parseExplanationText } from '@/lib/explanation-parser'

export const maxDuration = 60

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

  // 소유권 확인
  const { data: exam } = await supabase
    .from('exam_bank')
    .select('id')
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .single()

  if (!exam) return err('시험을 찾을 수 없습니다', 404)

  // Storage에서 PDF 다운로드
  const serviceClient = createServiceClient()
  const { data: fileBlob, error: downloadErr } = await serviceClient.storage
    .from('exam-pdf-temp')
    .download(storagePath)

  if (downloadErr || !fileBlob) {
    return err(`파일 다운로드 실패: ${downloadErr?.message}`)
  }

  // 처리 후 임시 파일 삭제
  void serviceClient.storage.from('exam-pdf-temp').remove([storagePath])

  // PDF → 텍스트 추출 (한 번만)
  const buffer = await fileBlob.arrayBuffer()
  let rawText = ''
  try {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const { text } = await extractText(pdf, { mergePages: true })
    rawText = text as string
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return err(`PDF 텍스트 추출 실패: ${msg}`, 422)
  }

  const rawPreview = rawText.slice(0, 500)

  let explanations
  try {
    explanations = parseExplanationText(rawText)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return err(`해설 PDF 파싱 실패: ${msg}\n\n[PDF 앞부분]\n${rawPreview}`, 422)
  }

  if (explanations.length === 0) {
    return err(`해설을 추출할 수 없습니다. 문항 경계(예: "18. [출제의도]")를 찾지 못했습니다.\n\n[PDF 앞부분]\n${rawPreview}`, 422)
  }

  // 문항번호 매칭하여 UPDATE
  let updated = 0
  for (const ex of explanations) {
    const { error } = await supabase
      .from('exam_bank_question')
      .update({
        explanation_intent: ex.intent,
        explanation_translation: ex.translation,
        explanation_solution: ex.solution,
        explanation_vocabulary: ex.vocabulary,
      })
      .eq('exam_bank_id', id)
      .eq('question_number', ex.question_number)

    if (!error) updated++
  }

  return ok({ updated, total: explanations.length })
}
