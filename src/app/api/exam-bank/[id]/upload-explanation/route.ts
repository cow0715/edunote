import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import { parsePdfExplanationsHakpyungRanged, parsePdfExplanationsWithClaudeRanged } from '@/lib/anthropic'
import { mergeExamVocabularyText, syncExamQuestionVocabulary } from '@/lib/exam-vocabulary'
import { enrichExamQuestionVocabulary } from '@/lib/vocab-enrichment'

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

  // 두 형식 모두 vision 출력 범위 분할(예열 + 범위 병렬)로 통일 — 추출과 AI 보완을 한 콜에:
  // 해석·출제의도는 원문 그대로 추출(창작 금지), 풀이·어휘는 원문 기반 작성 (학평은 원문에 없어 신규 작성).
  // 콘텐츠 필터에 걸린 범위는 문항 단위로 격리 재시도돼 진짜 걸린 문항만 결손된다 (skipped_questions).
  let explanations
  let skippedQuestions: number[] = []
  try {
    const parsed = hakpyung
      ? await parsePdfExplanationsHakpyungRanged(buffer)
      : await parsePdfExplanationsWithClaudeRanged(buffer)
    explanations = parsed.items
    skippedQuestions = parsed.skippedNumbers
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return err(`해설 PDF 파싱 실패: ${msg}`, 422)
  }
  if (explanations.length === 0) {
    return err('해설을 추출할 수 없습니다. PDF를 확인해주세요.', 422)
  }

  const { data: questionRows } = await supabase
    .from('exam_bank_question')
    .select('id, question_number, question_type, passage, explanation_vocabulary')
    .eq('exam_bank_id', id)
  const questionMap = new Map((questionRows ?? []).map((q) => [q.question_number, q]))

  // 문항번호 매칭하여 UPDATE (빈 값은 skip하여 기존 데이터 보존)
  let updated = 0
  const normalizedWords = new Set<string>()
  for (const ex of explanations) {
    const question = questionMap.get(ex.question_number)
    // 기존 어휘와 병합 — 재업로드해도 이미 쌓인 단어를 잃지 않는다
    const vocabulary = ex.vocabulary?.trim()
      ? mergeExamVocabularyText(question?.explanation_vocabulary, ex.vocabulary, undefined, question?.passage ?? '') || ex.vocabulary
      : null

    const updateData: Record<string, unknown> = {}
    if (ex.intent?.trim()) updateData.explanation_intent = ex.intent
    if (ex.translation?.trim()) updateData.explanation_translation = ex.translation
    if (ex.solution?.trim()) updateData.explanation_solution = ex.solution
    if (vocabulary) updateData.explanation_vocabulary = vocabulary

    if (Object.keys(updateData).length === 0) {
      updated++
      continue
    }

    const { error } = await supabase
      .from('exam_bank_question')
      .update(updateData)
      .eq('exam_bank_id', id)
      .eq('question_number', ex.question_number)

    if (!error) {
      if (question && vocabulary) {
        const synced = await syncExamQuestionVocabulary(supabase, question.id, vocabulary, question.question_type, question.passage)
        for (const word of synced.normalizedWords) normalizedWords.add(word)
      }
      updated++
    }
  }

  // 단어 DB 보강 (기존 generate-explanation 라우트에서 이식 — 뜻·예문 없는 신규 단어 채우기)
  let enriched = { candidates: 0, generated: 0, updated: 0 }
  if (normalizedWords.size > 0) {
    enriched = await enrichExamQuestionVocabulary(serviceClient, { normalizedWords: [...normalizedWords], limit: 300, batchSize: 40 })
  }

  return ok({
    updated,
    total: explanations.length,
    mode: hakpyung ? 'hakpyung' : 'standard',
    skipped_questions: skippedQuestions,
    enriched,
  })
}
