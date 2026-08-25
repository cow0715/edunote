import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import { parseExamBankPage } from '@/lib/anthropic'
import { runParsePipeline, type PipelineFile, type ChunkPolicy, type ChunkErrorPolicy } from '@/lib/llm/pipeline'
import { isContentFilterError } from '@/lib/llm/client'
import { getMegastudyStats } from '@/lib/megastudy'
import { NextResponse } from 'next/server'

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
// 기본은 PDF 를 통째로 1회 파싱. 콘텐츠 필터에 걸리면 같은 파일을 페이지 단위로 다시 돌려
// 걸린 페이지만 건너뛰고 나머지 문항을 건진다.
// (예전엔 클라이언트가 페이지별 PNG 로 렌더해 Storage 에 올리고 재요청했다. 이미지로 바꾼다고
//  필터를 통과하는 게 아니라 '걸린 페이지만 버리는' 게 목적이었으므로 서버 재분할로 충분하다 —
//  LLM 호출 횟수는 같고 브라우저 래스터화와 왕복만 없어진다.)
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

  // 정책만 갈아끼워 같은 파이프라인을 두 번 쓴다
  const parse = (chunk: ChunkPolicy, onChunkError: ChunkErrorPolicy) => runParsePipeline({
    label: 'exam-bank',
    chunk,
    onChunkError,
    parseChunk: (file: PipelineFile) => parseExamBankPage(file.fileData, file.mimeType),
    finalize: (qs) => qs,
  }, files)

  try {
    let questions: Awaited<ReturnType<typeof parseExamBankPage>>
    let skippedPages: number[] = []
    try {
      questions = (await parse({ kind: 'whole' }, 'throw')).items
    } catch (parseError) {
      // 이미지 업로드는 쪼갤 게 없어서 재시도해도 같은 결과 — 그대로 올린다
      if (!isContentFilterError(parseError) || mimeType !== 'application/pdf') throw parseError
      console.warn('[exam-bank] 콘텐츠 필터 → 페이지 단위 재파싱')
      const perPage = await parse({ kind: 'single-page' }, { skipIf: isContentFilterError })
      questions = perPage.items
      // single-page 정책에선 청크 순번 = 페이지 번호
      skippedPages = perPage.skippedChunks
    }

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
      skipped_pages: skippedPages,
      stats_fetched: statsFetched,
    })
  } catch (e) {
    await supabase.from('exam_bank').delete().eq('id', exam.id)
    console.error('[exam-bank] 파싱 실패', e)
    return err('PDF 파싱 실패. 파일을 확인해주세요.', 422)
  }
}
