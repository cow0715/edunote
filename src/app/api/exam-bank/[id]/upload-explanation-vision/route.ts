import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import { parsePdfExplanationsWithClaude } from '@/lib/anthropic'
import { syncExamQuestionVocabulary } from '@/lib/exam-vocabulary'
import { enrichExamQuestionVocabulary } from '@/lib/vocab-enrichment'

export const maxDuration = 300

// Claude Vision으로 해설 PDF를 직접 파싱 (unpdf 텍스트 추출 스킵)
// EBS 폰트 인코딩 문제 등 일반 파싱이 실패하는 PDF용
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

  const buffer = await fileBlob.arrayBuffer()

  let explanations
  try {
    explanations = await parsePdfExplanationsWithClaude(buffer)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return err(`Claude Vision 파싱 실패: ${msg}`, 500)
  }

  if (explanations.length === 0) {
    return err('Claude Vision이 문항을 찾지 못했습니다', 422)
  }

  const { data: questionRows } = await supabase
    .from('exam_bank_question')
    .select('id, question_number, question_type, passage')
    .eq('exam_bank_id', id)
  const questionMap = new Map((questionRows ?? []).map((q) => [q.question_number, q]))

  // 문항번호 매칭하여 UPDATE
  let updated = 0
  const normalizedWords = new Set<string>()
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

    if (!error) {
      const question = questionMap.get(ex.question_number)
      if (question) {
        const synced = await syncExamQuestionVocabulary(supabase, question.id, ex.vocabulary, question.question_type, question.passage)
        for (const word of synced.normalizedWords) normalizedWords.add(word)
      }
      updated++
    }
  }

  let enriched = { candidates: 0, generated: 0, updated: 0 }
  if (normalizedWords.size > 0) {
    enriched = await enrichExamQuestionVocabulary(supabase, { normalizedWords: [...normalizedWords], limit: 500, batchSize: 40 })
  }

  return ok({ updated, total: explanations.length, enriched })
}
