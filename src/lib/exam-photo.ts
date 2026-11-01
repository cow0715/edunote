import type { SupabaseServerClient } from '@/lib/api'

export const EXAM_PHOTO_REQUIRED = '답안지 사진의 저장을 확인하지 못했습니다. 답안은 반영하지 않았습니다. 사진을 다시 업로드해주세요.'

/** Never invent a successful upload from a legacy OCR response without its receipt. */
export function requireExamPhotoPath(weekId: string, studentId: string, photoPath: unknown): string {
  const expected = `${weekId}/${studentId}`
  if (typeof photoPath !== 'string' || (photoPath !== expected &&
    !(photoPath.startsWith(`${expected}/`) && /^[a-zA-Z0-9-]+$/.test(photoPath.slice(expected.length + 1))))) throw new Error(EXAM_PHOTO_REQUIRED)
  return photoPath
}

/** Check newly applied OCR receipts before any grade writes; historical photos must not block unrelated edits. */
export async function assertGradePhotosAvailable(
  supabase: SupabaseServerClient,
  weekId: string,
  rows: { student_id: string; present: boolean; reading_present: boolean; exam_photo_path?: string | null }[],
) {
  const targets = rows.filter((row) => row.present && row.reading_present !== false && row.exam_photo_path != null)
  if (!targets.length) return
  const { data: scores, error } = await supabase.from('week_score')
    .select('student_id, exam_photo_path').eq('week_id', weekId)
    .in('student_id', targets.map((row) => row.student_id))
  if (error) throw new Error('사진 연결 정보를 확인하지 못해 답안을 저장하지 않았습니다. 잠시 후 다시 시도해주세요.')
  const paths = new Map((scores ?? []).map((score) => [score.student_id, score.exam_photo_path]))
  for (const row of targets) {
    const stored = paths.get(row.student_id)
    const receipt = row.exam_photo_path
    const path = requireExamPhotoPath(weekId, row.student_id, receipt)
    if (path === `${weekId}/${row.student_id}` && stored !== path) throw new Error('답안지 사진과 학생의 연결을 확인하지 못해 답안을 저장하지 않았습니다. 사진을 다시 업로드해주세요.')
    const { data: file, error: fileError } = await supabase.storage.from('exam-photos').info(path)
    if (fileError || !file || !((file.size ?? 0) > 0)) {
      throw new Error('답안지 사진 파일을 확인하지 못해 답안을 저장하지 않았습니다. 사진을 다시 업로드해주세요.')
    }
  }
}
