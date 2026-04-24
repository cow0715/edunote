import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import { parseExamBankPage } from '@/lib/anthropic'
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

function isContentFilter(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes('Output blocked') || msg.includes('content filtering')
}

// POST — 기출 시험 생성 + PDF 파싱
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

  // ── 페이지 이미지 모드 (fallback) ─────────────────────────────────────────
  if (isPagesMode) {
    void serviceClient.storage.from('exam-pdf-temp').remove(storagePaths!)

    const { data: exam, error: examError } = await supabase
      .from('exam_bank')
      .insert({ teacher_id: teacherId, title, exam_year, exam_month, grade, source: source || '교육청', form_type: form_type || '홀수형' })
      .select()
      .single()

    if (examError) return err(examError.message)

    const questions: Awaited<ReturnType<typeof parseExamBankPage>> = []
    const skippedPages: number[] = []

    for (let i = 0; i < storagePaths!.length; i++) {
      try {
        const { data: fileBlob, error: downloadErr } = await serviceClient.storage
          .from('exam-pdf-temp')
          .download(storagePaths![i])
        if (downloadErr || !fileBlob) throw new Error(`다운로드 실패: ${downloadErr?.message}`)
        const fileData = await blobToBase64(fileBlob)
        const qs = await parseExamBankPage(fileData, mimeType)
        questions.push(...qs)
      } catch (e) {
        if (isContentFilter(e)) {
          console.log(`[exam-bank] page${i + 1} 필터됨, 건너뜀`)
          skippedPages.push(i + 1)
        } else throw e
      }
    }

    if (questions.length === 0) {
      await supabase.from('exam_bank').delete().eq('id', exam.id)
      return err('추출된 문항이 없습니다.', 422)
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

    let statsFetched = 0
    try {
      const formTypeVal: '홀수형' | '짝수형' = form_type === '짝수형' ? '짝수형' : '홀수형'
      const stats = await getMegastudyStats(grade, exam_year, exam_month, formTypeVal)
      if (stats && stats.length > 0) {
        for (const row of stats) {
          const { error: updateErr } = await supabase
            .from('exam_bank_question')
            .update({ answer: row.answer, difficulty: row.difficulty, points: row.points, correct_rate: row.correct_rate, choice_rates: row.choice_rates })
            .eq('exam_bank_id', exam.id)
            .eq('question_number', row.question_number)
          if (!updateErr) statsFetched++
        }
      }
    } catch { /* 통계 실패 무시 */ }

    return ok({ ok: true, exam_id: exam.id, question_count: questions.length, skipped_pages: skippedPages, stats_fetched: statsFetched })
  }

  // ── 단일 PDF 모드 (기본) ───────────────────────────────────────────────────
  const { data: fileBlob, error: downloadErr } = await serviceClient.storage
    .from('exam-pdf-temp')
    .download(storagePath!)

  if (downloadErr || !fileBlob) return err(`파일 다운로드 실패: ${downloadErr?.message}`)

  const fileData = await blobToBase64(fileBlob)
  void serviceClient.storage.from('exam-pdf-temp').remove([storagePath!])

  const { data: exam, error: examError } = await supabase
    .from('exam_bank')
    .insert({ teacher_id: teacherId, title, exam_year, exam_month, grade, source: source || '교육청', form_type: form_type || '홀수형' })
    .select()
    .single()

  if (examError) return err(examError.message)

  try {
    const questions = await parseExamBankPage(fileData, mimeType)

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

    let statsFetched = 0
    try {
      const formTypeVal: '홀수형' | '짝수형' = form_type === '짝수형' ? '짝수형' : '홀수형'
      const stats = await getMegastudyStats(grade, exam_year, exam_month, formTypeVal)
      if (stats && stats.length > 0) {
        for (const row of stats) {
          const { error: updateErr } = await supabase
            .from('exam_bank_question')
            .update({ answer: row.answer, difficulty: row.difficulty, points: row.points, correct_rate: row.correct_rate, choice_rates: row.choice_rates })
            .eq('exam_bank_id', exam.id)
            .eq('question_number', row.question_number)
          if (!updateErr) statsFetched++
        }
      }
    } catch { /* 통계 실패 무시 */ }

    return ok({ ok: true, exam_id: exam.id, question_count: questions.length, stats_fetched: statsFetched })
  } catch (e) {
    await supabase.from('exam_bank').delete().eq('id', exam.id)
    console.error('[exam-bank] 파싱 실패', e)
    if (isContentFilter(e)) {
      return NextResponse.json({ error: '일부 페이지가 AI 필터에 걸렸습니다. 페이지별 재처리를 시도합니다.', contentFilter: true }, { status: 422 })
    }
    return err('PDF 파싱 실패. 파일을 확인해주세요.', 422)
  }
}
