import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// 복원 순서 (FK 의존성 순서)
const RESTORE_ORDER = [
  'teacher',
  'concept_category',
  'concept_tag',
  'class',
  'student',
  'class_student',
  'week',
  'exam_question',
  'exam_question_tag',
  'week_score',
  'student_answer',
  'attendance',
  'teacher_memos',
] as const

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { file } = await request.json()
  if (!file) return NextResponse.json({ error: 'file 파라미터 필요' }, { status: 400 })

  // ── 1. Storage에서 백업 파일 다운로드 ───────────────────────────────────
  const { data: fileData, error: downloadErr } = await supabase.storage
    .from('backup')
    .download(file)

  if (downloadErr || !fileData) {
    return NextResponse.json({ error: `파일 다운로드 실패: ${downloadErr?.message}` }, { status: 500 })
  }

  // ── 2. JSON 파싱 ────────────────────────────────────────────────────────
  const text = await fileData.text()
  let dump: { version: number; created_at: string; tables: Record<string, unknown[]> }
  try {
    dump = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패 - 유효하지 않은 백업 파일' }, { status: 400 })
  }

  if (!dump.tables) {
    return NextResponse.json({ error: '유효하지 않은 백업 형식 (tables 없음)' }, { status: 400 })
  }

  // ── 3. 테이블별 upsert (FK 순서대로) ───────────────────────────────────
  const results: Record<string, { upserted: number; error?: string }> = {}

  for (const table of RESTORE_ORDER) {
    const rows = dump.tables[table]
    if (!rows || rows.length === 0) {
      results[table] = { upserted: 0 }
      continue
    }

    // 청크 단위로 upsert (한 번에 너무 많으면 오류 가능)
    const CHUNK = 500
    let upserted = 0
    let err: string | undefined

    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      const { error } = await supabase
        .from(table)
        .upsert(chunk as never[], { onConflict: 'id' })

      if (error) {
        err = error.message
        console.error(`[restore] ${table} upsert 실패:`, error)
        break
      }
      upserted += chunk.length
    }

    results[table] = { upserted, ...(err ? { error: err } : {}) }
  }

  const hasError = Object.values(results).some((r) => r.error)
  console.log('[restore] 완료:', results)

  return NextResponse.json({
    ok: !hasError,
    file,
    backup_created_at: dump.created_at,
    results,
  }, { status: hasError ? 207 : 200 })
}
