import { createServiceClient } from '@/lib/supabase/service'

type Stage = 'received' | 'upload' | 'verify' | 'ocr' | 'grade_save'
type Outcome = 'started' | 'succeeded' | 'failed'

export type ExamPhotoLogTarget = {
  studentId: string
  photoId: string
}

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i

export async function logExamPhotos(
  weekId: string,
  targets: ExamPhotoLogTarget[],
  stage: Stage,
  outcome: Outcome,
  status?: number,
) {
  if (!uuid.test(weekId)) return
  const events = targets
    .filter(({ studentId, photoId }) => uuid.test(studentId) && uuid.test(photoId))
    .map(({ studentId, photoId }) => ({
      week_id: weekId,
      student_id: studentId,
      photo_id: photoId,
      stage,
      outcome,
      http_status: status ?? null,
      deployment_id: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    }))
  if (!events.length) return

  console.info('[exam-photo]', JSON.stringify(events))
  try {
    const { error } = await createServiceClient().from('exam_photo_event')
      .insert(events).abortSignal(AbortSignal.timeout(1000))
    if (error) console.warn('[exam-photo] event_write_failed', { code: error.code })
  } catch {
    console.warn('[exam-photo] event_write_failed')
  }
}
