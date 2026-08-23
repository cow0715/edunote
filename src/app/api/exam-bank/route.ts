import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import { parseExamBankPage } from '@/lib/anthropic'
import { runParsePipeline, type PipelineFile } from '@/lib/llm/pipeline'
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
// 기본: PDF 1개를 통째로 1회 파싱. 콘텐츠 필터로 전체가 막히면 422 {contentFilter:true} 를 돌려주고,
// 클라이언트가 페이지별 PNG(storagePaths)로 재요청하면 페이지 단위로 파싱하되 막힌 페이지만 건너뛴다.
export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const body = await request.json()
  const { title, exam_year, exam_month, grade, source, form_type, mimeType } = body
  const storagePath: string | undefined = body.storagePath
  const storagePaths: string[] | undefined = body.storagePaths

  if (!title || !exam_year || !exam_month || !grade) {
    return err('필수 정보 누락 (title, exam_year, exam_month, grade)')
  }
  if ((!storagePath && !storagePaths?.length) || !mimeType) {
    return err('파일 필요')
  }

  const serviceClient = createServiceClient()
  const isPagesMode = !!storagePaths?.length
  const paths = isPagesMode ? storagePaths! : [storagePath!]

  let files: PipelineFile[]
  try {
    files = await downloadTempFiles(serviceClient, paths, mimeType)
  } catch (e) {
    return err(e instanceof Error ? e.message : '파일 다운로드 실패')
  }
  void serviceClient.storage.from('exam-pdf-temp').remove(paths)

  const { data: exam, error: examError } = await supabase
    .from('exam_bank')
    .insert({ teacher_id: teacherId, title, exam_year, exam_month, grade, source: source || '교육청', form_type: form_type || '홀수형' })
    .select()
    .single()
  if (examError) return err(examError.message)

  try {
    const { items: questions, skippedChunks } = await runParsePipeline({
      label: 'exam-bank',
      chunk: { kind: 'whole' },
      // 페이지 모드에선 필터 걸린 페이지만 건너뛰고 계속, 단일 PDF 모드에선 전체 실패로 올려 클라가 페이지 모드로 재시도하게
      onChunkError: isPagesMode ? { skipIf: isContentFilterError } : 'throw',
      parseChunk: (file) => parseExamBankPage(file.fileData, file.mimeType),
      finalize: (qs) => qs,
    }, files)

    if (questions.length === 0) {
      await supabase.from('exam_bank').delete().eq('id', exam.id)
      return err(isPagesMode ? '추출된 문항이 없습니다.' : '문항을 추출할 수 없습니다. PDF를 확인해주세요.', 422)
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
      ...(isPagesMode ? { skipped_pages: skippedChunks } : {}),
      stats_fetched: statsFetched,
    })
  } catch (e) {
    await supabase.from('exam_bank').delete().eq('id', exam.id)
    console.error('[exam-bank] 파싱 실패', e)
    if (isContentFilterError(e)) {
      return NextResponse.json({ error: '일부 페이지가 AI 필터에 걸렸습니다. 페이지별 재처리를 시도합니다.', contentFilter: true }, { status: 422 })
    }
    return err('PDF 파싱 실패. 파일을 확인해주세요.', 422)
  }
}
