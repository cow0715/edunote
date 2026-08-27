import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import { parseExamBankPageRanged } from '@/lib/anthropic'
import type { PipelineFile } from '@/lib/llm/pipeline'
import { getMegastudyStats } from '@/lib/megastudy'

export const maxDuration = 300

// GET — 기출 시험 목록 조회
export async function GET() {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { data, error } = await supabase
    .from('exam_bank')
    .select('*')
    .eq('teacher_id', teacherId)
    .order('exam_year', { ascending: false })
    .order('exam_month', { ascending: false })

  if (error) return err(error.message)

  const shaped = (data ?? []).map((row) => ({
    ...row,
    exam_bank_question: [{ count: row.question_count ?? 0 }],
  }))
  return ok(shaped)
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function downloadTempFiles(serviceClient: ReturnType<typeof createServiceClient>, paths: string[], mimeType: string): Promise<PipelineFile[]> {
  const files: PipelineFile[] = []
  for (const path of paths) {
    const { data, error } = await serviceClient.storage.from('exam-pdf-temp').download(path)
    if (error || !data) throw new Error(`파일 다운로드 실패: ${error?.message}`)
    files.push({ fileData: await blobToBase64(data), mimeType, fileName: path })
  }
  return files
}

async function fetchAndApplyStats(
  supabase: Awaited<ReturnType<typeof getAuth>>['supabase'],
  examId: string,
  params: { grade: number; exam_year: number; exam_month: number; form_type?: string },
): Promise<number> {
  let statsFetched = 0
  try {
    const formTypeVal: '홀수형' | '짝수형' = params.form_type === '짝수형' ? '짝수형' : '홀수형'
    const stats = await getMegastudyStats(params.grade, params.exam_year, params.exam_month, formTypeVal)
    for (const row of stats ?? []) {
      const { error: updateErr } = await supabase
        .from('exam_bank_question')
        .update({ answer: row.answer, difficulty: row.difficulty, points: row.points, correct_rate: row.correct_rate, choice_rates: row.choice_rates })
        .eq('exam_bank_id', examId)
        .eq('question_number', row.question_number)
      if (!updateErr) statsFetched++
    }
  } catch { /* 통계 실패 무시 — 파싱 결과는 살린다 */ }
  return statsFetched
}

// POST — 기출 시험 생성 + PDF 파싱
// 출력 범위 분할(캐시 예열 → 5범위 병렬): 기출은 번호가 18~45 고정이라 출력을 선험 분할할 수 있고,
// 매 콜 문서 전체를 보므로 지문 분리 문제가 없다. 실측(8p 모평, 2026-08-26): whole 256s →
// 입력 청킹 133s → 범위 분할이 추가 단축. 필터는 걸린 범위만 skip 하고 결손 번호를 보고한다.
export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const body = await request.json()
  const { title, exam_year, exam_month, grade, source, form_type, mimeType } = body
  const storagePath: string | undefined = body.storagePath

  if (!title || !exam_year || !exam_month || !grade) {
    return err('필수 정보 누락 (title, exam_year, exam_month, grade)')
  }
  if (!storagePath || !mimeType) {
    return err('파일 필요')
  }

  const serviceClient = createServiceClient()

  let files: PipelineFile[]
  try {
    files = await downloadTempFiles(serviceClient, [storagePath], mimeType)
  } catch (e) {
    return err(e instanceof Error ? e.message : '파일 다운로드 실패')
  }
  void serviceClient.storage.from('exam-pdf-temp').remove([storagePath])

  const { data: exam, error: examError } = await supabase
    .from('exam_bank')
    .insert({ teacher_id: teacherId, title, exam_year, exam_month, grade, source: source || '교육청', form_type: form_type || '홀수형' })
    .select()
    .single()
  if (examError) return err(examError.message)

  try {
    const [file] = files
    const result = await parseExamBankPageRanged(file.fileData, file.mimeType)
    const questions = result.items
    // 필터 결손 문항 번호 (문항 단위 격리 재시도 후에도 걸린 것만)
    const skippedQuestions = result.skippedNumbers

    if (questions.length === 0) {
      await supabase.from('exam_bank').delete().eq('id', exam.id)
      return err('문항을 추출할 수 없습니다. PDF를 확인해주세요.', 422)
    }

    const rows = questions.map((q) => ({
      exam_bank_id: exam.id,
      question_number: q.question_number,
      question_type: q.question_type,
      passage: q.passage || '',
      question_text: q.question_text,
      choices: q.choices || [],
      answer: q.answer || '',
      raw_text: '',
    }))

    const { error: insertError } = await supabase.from('exam_bank_question').insert(rows)
    if (insertError) {
      await supabase.from('exam_bank').delete().eq('id', exam.id)
      return err(`문항 저장 실패: ${insertError.message}`)
    }

    const statsFetched = await fetchAndApplyStats(supabase, exam.id, { grade, exam_year, exam_month, form_type })

    return ok({
      ok: true,
      exam_id: exam.id,
      question_count: questions.length,
      // 하위호환 필드명 유지 — 값은 결손 문항 번호 (범위 분할엔 페이지 개념이 없음)
      skipped_pages: skippedQuestions,
      stats_fetched: statsFetched,
    })
  } catch (e) {
    await supabase.from('exam_bank').delete().eq('id', exam.id)
    console.error('[exam-bank] 파싱 실패', e)
    return err('PDF 파싱 실패. 파일을 확인해주세요.', 422)
  }
}
