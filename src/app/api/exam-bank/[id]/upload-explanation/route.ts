import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import { parseExplanationText } from '@/lib/explanation-parser'
import { parsePdfExplanationsHakpyung } from '@/lib/anthropic'

export const maxDuration = 300

// 6, 9월 → 평가원 / 11월 → 수능 / 나머지 → 학평(교육청)
const HAKPYUNG_MONTHS = [3, 4, 5, 7, 10]

function isHakpyung(month: number): boolean {
  return HAKPYUNG_MONTHS.includes(month)
}

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

  // 소유권 + 시험 월 확인
  const { data: exam } = await supabase
    .from('exam_bank')
    .select('id, exam_month')
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .single()

  if (!exam) return err('시험을 찾을 수 없습니다', 404)

  const hakpyung = isHakpyung(exam.exam_month)

  // Storage에서 PDF 다운로드
  const serviceClient = createServiceClient()
  const { data: fileBlob, error: downloadErr } = await serviceClient.storage
    .from('exam-pdf-temp')
    .download(storagePath)

  if (downloadErr || !fileBlob) {
    return err(`파일 다운로드 실패: ${downloadErr?.message}`)
  }

  void serviceClient.storage.from('exam-pdf-temp').remove([storagePath])

  const buffer = await fileBlob.arrayBuffer()

  let explanations
  if (hakpyung) {
    // 학평: Claude Vision으로 출제의도 + 해석 추출 (풀이/어휘는 generate-explanation에서 생성)
    try {
      explanations = await parsePdfExplanationsHakpyung(buffer)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return err(`학평 해설 PDF 파싱 실패: ${msg}`, 422)
    }
  } else {
    // 평가원/수능: 기존 텍스트 정규식 파서
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
    try {
      explanations = parseExplanationText(rawText)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return err(`해설 PDF 파싱 실패: ${msg}\n\n[PDF 앞부분]\n${rawPreview}`, 422)
    }

    if (explanations.length === 0) {
      return err(`해설을 추출할 수 없습니다. 문항 경계(예: "18. [출제의도]")를 찾지 못했습니다.\n\n[PDF 앞부분]\n${rawPreview}`, 422)
    }
  }

  // 문항번호 매칭하여 UPDATE
  let updated = 0
  for (const ex of explanations) {
    const { error } = await supabase
      .from('exam_bank_question')
      .update({
        explanation_intent: ex.intent,
        explanation_translation: ex.translation,
        explanation_solution: ex.solution || null,
        explanation_vocabulary: ex.vocabulary || null,
      })
      .eq('exam_bank_id', id)
      .eq('question_number', ex.question_number)

    if (!error) updated++
  }

  return ok({ updated, total: explanations.length, mode: hakpyung ? 'hakpyung' : 'standard' })
}
