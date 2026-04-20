import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import { parseExamBankPage } from '@/lib/anthropic'
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

  // 클라이언트 호환: exam_bank_question: [{ count }] shape 유지
  const shaped = (data ?? []).map((row) => ({
    ...row,
    exam_bank_question: [{ count: row.question_count ?? 0 }],
  }))
  return ok(shaped)
}

// POST — 기출 시험 생성 + PDF 파싱
export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { title, exam_year, exam_month, grade, source, form_type, storagePath, mimeType } = await request.json()

  if (!title || !exam_year || !exam_month || !grade) {
    return err('필수 정보 누락 (title, exam_year, exam_month, grade)')
  }
  if (!storagePath || !mimeType) {
    return err('PDF 파일 필요')
  }

  // Storage에서 PDF 다운로드
  const serviceClient = createServiceClient()
  const { data: fileBlob, error: downloadErr } = await serviceClient.storage
    .from('exam-pdf-temp')
    .download(storagePath)

  if (downloadErr || !fileBlob) {
    return err(`파일 다운로드 실패: ${downloadErr?.message}`)
  }

  const buffer = await fileBlob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  const fileData = btoa(binary)

  // 처리 후 임시 파일 삭제 (에러 여부 무관)
  void serviceClient.storage.from('exam-pdf-temp').remove([storagePath])

  // 1. exam_bank 레코드 생성
  const { data: exam, error: examError } = await supabase
    .from('exam_bank')
    .insert({ teacher_id: teacherId, title, exam_year, exam_month, grade, source: source || '교육청', form_type: form_type || '홀수형' })
    .select()
    .single()

  if (examError) return err(examError.message)

  // 2. PDF 파싱 (Claude Vision)
  try {
    const questions = await parseExamBankPage(fileData, mimeType)

    if (questions.length === 0) {
      // 파싱 실패 시 exam_bank도 삭제
      await supabase.from('exam_bank').delete().eq('id', exam.id)
      return err('문항을 추출할 수 없습니다. PDF를 확인해주세요.', 422)
    }

    // 3. 문항 저장
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

    const { error: insertError } = await supabase
      .from('exam_bank_question')
      .insert(rows)

    if (insertError) {
      await supabase.from('exam_bank').delete().eq('id', exam.id)
      return err(`문항 저장 실패: ${insertError.message}`)
    }

    // 메가스터디 통계 자동 fetch (실패해도 업로드는 성공 처리)
    let statsFetched = 0
    try {
      const formTypeVal: '홀수형' | '짝수형' = form_type === '짝수형' ? '짝수형' : '홀수형'
      const stats = await getMegastudyStats(grade, exam_year, exam_month, formTypeVal)
      if (stats && stats.length > 0) {
        for (const row of stats) {
          const { error: updateErr } = await supabase
            .from('exam_bank_question')
            .update({
              answer: row.answer,
              difficulty: row.difficulty,
              points: row.points,
              correct_rate: row.correct_rate,
              choice_rates: row.choice_rates,
            })
            .eq('exam_bank_id', exam.id)
            .eq('question_number', row.question_number)
          if (!updateErr) statsFetched++
        }
      }
    } catch {
      // 통계 fetch 실패는 무시
    }

    return ok({ ok: true, exam_id: exam.id, question_count: questions.length, stats_fetched: statsFetched })
  } catch (e) {
    // 파싱 에러 시 exam_bank 삭제
    await supabase.from('exam_bank').delete().eq('id', exam.id)
    console.error('[exam-bank] 파싱 실패', e)
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('content filtering')) {
      return err('이 PDF는 AI 안전 필터에 걸려 파싱할 수 없습니다. 다른 연도/파일로 시도해주세요.', 422)
    }
    return err('PDF 파싱 실패. 파일을 확인해주세요.', 422)
  }
}
