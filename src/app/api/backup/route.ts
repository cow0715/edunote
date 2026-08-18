import { getAuth, err, ok } from '@/lib/api'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { uploadToS3 } from '@/lib/s3-backup'
import { pruneOldBackups } from '@/lib/backup-retention'
import { pruneOldVocabPhotos } from '@/lib/vocab-photo-retention'

const TABLES = [
  'teacher', 'concept_category', 'concept_tag', 'class',
  'class_period', 'student', 'class_student', 'week', 'exam_question',
  'exam_question_tag', 'week_score', 'student_answer',
  'attendance', 'teacher_memos',
] as const

type ServiceClient = ReturnType<typeof createServiceClient>

// ── 페이지네이션으로 전체 행 가져오기 (Supabase 기본 1000건 제한 우회) ──────
async function fetchAllRows(supabase: ServiceClient, table: string): Promise<unknown[]> {
  const PAGE_SIZE = 1000
  const rows: unknown[] = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw new Error(`${table} 조회 실패: ${error.message}`)
    if (!data || data.length === 0) break

    rows.push(...data)
    offset += data.length

    if (data.length < PAGE_SIZE) break // 마지막 페이지
  }

  return rows
}

export async function POST(request: Request) {
  // cron 또는 인증된 사용자 허용
  const authHeader = request.headers.get('authorization')
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`
  if (!isCron) {
    const supabaseUser = await createClient()
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) return err('인증 필요', 401)
  }

  const supabase = createServiceClient()

  // ── 전체 테이블 덤프 (FK 순서, 페이지네이션) ──────────────────────────────
  const tableData: Record<string, unknown[]> = {}
  const tableErrors: Record<string, string> = {}

  for (const table of TABLES) {
    try {
      tableData[table] = await fetchAllRows(supabase, table)
    } catch (e) {
      tableErrors[table] = e instanceof Error ? e.message : String(e)
    }
  }

  if (Object.keys(tableErrors).length > 0) {
    const msg = Object.entries(tableErrors)
      .map(([t, e]) => `${t}: ${e}`)
      .join(', ')
    console.error('[backup] 테이블 조회 실패:', msg)
    await supabase.from('backup_log').insert({
      triggered_by: isCron ? 'cron' : 'manual',
      status: 'error',
      error_msg: `테이블 조회 실패: ${msg}`,
    })
    return err(`테이블 조회 실패: ${msg}`, 500)
  }

  const dump = {
    version: 2,
    created_at: new Date().toISOString(),
    tables: tableData,
  }

  const buffer = Buffer.from(JSON.stringify(dump, null, 2), 'utf-8')
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const timeStr = now.toISOString().slice(11, 16).replace(':', '')
  const fileName = `backup_${dateStr}_${timeStr}.json`

  const rowCounts = Object.fromEntries(
    Object.entries(tableData).map(([k, v]) => [k, v.length]),
  )

  // ── Supabase Storage 업로드 ──────────────────────────────────────────────
  const { error: uploadErr } = await supabase.storage
    .from('backup')
    .upload(fileName, buffer, { contentType: 'application/json', upsert: true })

  if (uploadErr) {
    console.error('[backup] Storage 저장 실패:', uploadErr)
    await supabase.from('backup_log').insert({
      triggered_by: isCron ? 'cron' : 'manual',
      status: 'error',
      error_msg: uploadErr.message,
    })
    return err(uploadErr.message, 500)
  }

  // ── 외부 S3/R2 이중 업로드 (환경변수 설정 시) ────────────────────────────
  const s3Err = await uploadToS3(fileName, buffer)
  if (s3Err) {
    console.warn('[backup] S3 이중 업로드 실패 (Supabase는 성공):', s3Err)
  }

  // ── 오래된 백업 정리 ────────────────────────────────────────────────────
  // 이게 없어서 백업이 무한정 쌓였고 Storage 용량을 초과했다.
  // 보관 개수는 BACKUP_RETENTION_COUNT 환경변수로 조절 (기본 14).
  // 정리 실패는 백업 실패가 아니므로 경고만 남기고 넘어간다.
  // justUploaded: 목록 조회가 제대로 됐는지 확인하는 기준점.
  // storage.list() 는 접속 실패해도 빈 배열을 주기 때문에 이 검사가 필요하다.
  const prune = await pruneOldBackups(supabase, { justUploaded: fileName })
  if (prune.error) {
    console.warn('[backup] 오래된 백업 정리 실패:', prune.error)
  } else if (prune.deleted.length > 0) {
    console.log(`[backup] 오래된 백업 ${prune.deleted.length}개 삭제 (보관 ${prune.kept}개)`)
  }

  // ── 단어 시험지 사진 정리 (기본 30일, VOCAB_PHOTO_RETENTION_DAYS) ─────────
  // 폰 사진 원본이 학생당 3~6MB 씩 쌓여 Storage 를 채웠다. 업로드 압축(1/15)과 함께 용량 대책.
  // 백업과 무관한 작업이라 실패해도 경고만.
  const photoPrune = await pruneOldVocabPhotos(supabase)
  if (photoPrune.error) {
    console.warn('[backup] 단어 사진 정리 실패:', photoPrune.error)
  } else if (photoPrune.deleted.length > 0) {
    console.log(`[backup] 단어 사진 ${photoPrune.deleted.length}개 삭제 (전체 ${photoPrune.scanned}개 중)`)
  }

  await supabase.from('backup_log').insert({
    triggered_by: isCron ? 'cron' : 'manual',
    status: 'success',
    file_name: fileName,
    row_counts: rowCounts,
  })

  console.log('[backup] 완료:', fileName, rowCounts, s3Err ? `S3경고: ${s3Err}` : 'S3도 성공')
  return ok({
    ok: true,
    file: fileName,
    rows: rowCounts,
    s3_warning: s3Err ?? null,
    pruned: prune.deleted.length,
    kept: prune.kept,
    prune_warning: prune.error ?? null,
  })
}

// 백업 파일 목록 조회 or signed URL 발급
export async function GET(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { searchParams } = new URL(request.url)
  const file = searchParams.get('file')

  if (!file) {
    const { data: files } = await supabase.storage
      .from('backup')
      .list('', { sortBy: { column: 'name', order: 'desc' }, limit: 30 })
    return ok({ files: files ?? [] })
  }

  const { data, error } = await supabase.storage.from('backup').createSignedUrl(file, 3600)
  if (error) return err(error.message, 500)
  return ok({ url: data.signedUrl })
}
