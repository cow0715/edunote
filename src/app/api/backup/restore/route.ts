import { getAuth, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'

// FK 의존성 순서 (복원 시 부모 → 자식)
const RESTORE_ORDER = [
  'teacher', 'concept_category', 'concept_tag', 'class',
  'student', 'class_student', 'week', 'exam_question',
  'exam_question_tag', 'week_score', 'student_answer',
  'attendance', 'teacher_memos',
] as const

const CHUNK = 500

export async function POST(request: Request) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { file } = await request.json()
  if (!file) return err('file 파라미터 필요')

  // service role 사용: RLS 우회 + truncate RPC 호출 권한
  const supabase = createServiceClient()

  // ── 1. Storage에서 백업 파일 다운로드 ───────────────────────────────────
  const { data: fileData, error: downloadErr } = await supabase.storage
    .from('backup')
    .download(file)

  if (downloadErr || !fileData) {
    return err(`파일 다운로드 실패: ${downloadErr?.message}`, 500)
  }

  // ── 2. JSON 파싱 ────────────────────────────────────────────────────────
  const text = await fileData.text()
  let dump: { version: number; created_at: string; tables: Record<string, unknown[]> }
  try {
    dump = JSON.parse(text)
  } catch {
    return err('JSON 파싱 실패 - 유효하지 않은 백업 파일')
  }

  if (!dump.tables) return err('유효하지 않은 백업 형식 (tables 없음)')

  // ── 3. 사전 검증: 필수 테이블 존재 확인 ────────────────────────────────
  const missingTables = RESTORE_ORDER.filter((t) => !(t in dump.tables))
  if (missingTables.length > 0) {
    return err(`백업 파일에 누락된 테이블: ${missingTables.join(', ')}`)
  }

  // ── 4. 기존 데이터 전체 삭제 (역순 FK, DB 함수로 원자적 처리) ───────────
  const { error: truncateErr } = await supabase.rpc('restore_truncate_tables')
  if (truncateErr) {
    return err(`데이터 초기화 실패: ${truncateErr.message}`, 500)
  }

  // ── 5. 테이블별 INSERT (FK 순서대로) ────────────────────────────────────
  const results: Record<string, { inserted: number; error?: string }> = {}
  let hasError = false

  for (const table of RESTORE_ORDER) {
    const rows = dump.tables[table]
    if (!rows || rows.length === 0) {
      results[table] = { inserted: 0 }
      continue
    }

    let inserted = 0
    let errMsg: string | undefined

    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      const { error } = await supabase.from(table).insert(chunk as never[])

      if (error) {
        errMsg = error.message
        console.error(`[restore] ${table} insert 실패:`, error)
        hasError = true
        break
      }
      inserted += chunk.length
    }

    results[table] = { inserted, ...(errMsg ? { error: errMsg } : {}) }

    // FK 위반 방지: 부모 테이블 insert 실패 시 이후 자식 테이블 중단
    if (errMsg) break
  }

  console.log('[restore] 완료:', results)
  return ok(
    { ok: !hasError, file, backup_created_at: dump.created_at, results },
    { status: hasError ? 207 : 200 },
  )
}
