import { sortQuestionsByPdf } from '@/lib/question-presentation'
import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import { ocrExamAnswers, ExamOcrQuestion } from '@/lib/anthropic'
import { oxNotation } from '@/lib/ox-grading'
import { EXAM_PHOTO_BUCKET } from '@/lib/photo-buckets'
import { requireExamPhotoPath } from '@/lib/exam-photo'
import { logExamPhotos } from '@/lib/exam-photo-log'
import { createServiceClient } from '@/lib/supabase/service'

export const maxDuration = 60

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

  const { fileData, mimeType, studentId, useStored, storeOnly, photoPath, jobId } = await request.json() as {
    fileData?: string
    mimeType?: string
    studentId?: string
    /** true 면 파일 대신 저장된 사진(exam-photos/{weekId}/{studentId})으로 재판독 */
    useStored?: boolean
    storeOnly?: boolean
    photoPath?: string
    jobId?: string
  }
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)
  if (storeOnly && useStored) return err('사진 요청을 확인해 주세요.')

  if (!studentId) return err('사진을 저장할 학생을 선택해주세요.')
  const { data: weekRow, error: weekError } = await supabase
    .from('week').select('class_id').eq('id', weekId).single()
  if (weekError || !weekRow) return err('사진을 저장할 수업을 확인하지 못했습니다.', 503)
  const { data: classStudent, error: studentError } = await supabase
    .from('class_student').select('student_id')
    .eq('class_id', weekRow.class_id).eq('student_id', studentId).maybeSingle()
  if (studentError) return err('학생 연결 정보를 확인하지 못했습니다. 다시 시도해주세요.', 503)
  if (!classStudent) return err('해당 수업 학생이 아닙니다.', 403)
  const jobDb = jobId ? createServiceClient() : null
  let jobPhotoPath: string | null = null
  if (jobDb) {
    if (!storeOnly && !useStored) return err('채점 작업 요청을 확인해 주세요.')
    const { data: item, error } = await jobDb.from('exam_photo_job_item')
      .select('photo_path, ocr_results, exam_photo_job!inner(id)')
      .eq('job_id', jobId).eq('student_id', studentId)
      .eq('exam_photo_job.week_id', weekId).eq('exam_photo_job.teacher_id', teacherId)
      .is('exam_photo_job.closed_at', null).maybeSingle()
    if (error) return err('채점 작업을 확인하지 못했습니다.', 503)
    if (!item) return err('채점 작업에서 학생을 찾을 수 없습니다.', 404)
    jobPhotoPath = item.photo_path
    if (storeOnly && jobPhotoPath) return ok({ ok: true, photoPath: jobPhotoPath })
    if (useStored) {
      if (!jobPhotoPath) return err('저장된 답안지 사진이 없습니다.', 409)
      if (Array.isArray(item.ocr_results)) return ok({ ok: true, results: item.ocr_results, photoPath: jobPhotoPath })
      const { count, error: pendingError } = await jobDb.from('exam_photo_job_item')
        .select('student_id', { count: 'exact', head: true }).eq('job_id', jobId).is('photo_path', null)
      if (pendingError) return err('사진 저장 상태를 확인하지 못했습니다.', 503)
      if (count !== 0) return err('작업의 모든 사진을 먼저 저장해 주세요.', 409)
    }
  }
  const photoId = jobId ?? crypto.randomUUID()
  const targets = useStored ? [] : [{ studentId, photoId }]
  await logExamPhotos(weekId, targets, 'received', 'started')
  let storagePath = `${weekId}/${studentId}/${photoId}`

  // 판독할 이미지: 업로드 파일 또는 저장된 사진
  let imageData = fileData ?? null
  let imageMime = mimeType ?? null
  if (useStored) {
    if (jobPhotoPath) storagePath = jobPhotoPath
    else if (photoPath) storagePath = photoPath
    else {
      const { data: saved, error: savedError } = await supabase.from('week_score')
        .select('exam_photo_path').eq('week_id', weekId).eq('student_id', studentId).maybeSingle()
      if (savedError) return err('저장된 사진을 확인하지 못했습니다.', 503)
      storagePath = saved?.exam_photo_path ?? `${weekId}/${studentId}`
    }
    try { storagePath = requireExamPhotoPath(weekId, studentId, storagePath) }
    catch { return err('저장된 사진과 학생의 연결을 확인하지 못했습니다.', 409) }
    const storedPhotoId = storagePath.split('/')[2]
    if (storedPhotoId) targets.push({ studentId, photoId: storedPhotoId })
    const { data: blob, error: downloadError } = await supabase.storage
      .from(EXAM_PHOTO_BUCKET)
      .download(storagePath)
    if (downloadError || !blob) return err('저장된 답안지 사진이 없습니다', 404)
    imageData = Buffer.from(await blob.arrayBuffer()).toString('base64')
    imageMime = blob.type || 'image/jpeg'
  }
  if (!imageData || !imageMime) {
    await logExamPhotos(weekId, targets, 'received', 'failed', 400)
    return err('파일 없음')
  }

  // OCR보다 먼저 보관한다. 저장 실패를 OCR 성공으로 가리지 않는다.
  if (!useStored) {
    try {
      const { error: uploadError } = await supabase.storage
        .from(EXAM_PHOTO_BUCKET)
        .upload(storagePath, Buffer.from(imageData, 'base64'), { contentType: imageMime, upsert: false })
      if (uploadError && !jobDb) {
        console.error('[ocr-exam-photo] 사진 업로드 실패', uploadError)
        await logExamPhotos(weekId, targets, 'upload', 'failed', 503)
        return err('답안지 사진 저장에 실패했습니다. 판독을 시작하지 않았습니다. 사진을 다시 업로드해주세요.', 503)
      }
    } catch (e) {
      console.error('[ocr-exam-photo] 사진 업로드 예외', e)
      await logExamPhotos(weekId, targets, 'upload', 'failed', 503)
      return err('답안지 사진 저장에 실패했습니다. 판독을 시작하지 않았습니다. 사진을 다시 업로드해주세요.', 503)
    }

  }

  // Verify nonempty object metadata, not just that upload returned no error.
  try {
    const { data: photo, error: photoError } = await supabase.storage.from(EXAM_PHOTO_BUCKET).info(storagePath)
    if (photoError || !photo || !((photo.size ?? 0) > 0)) {
      console.error('[ocr-exam-photo] photo_verify_failed', { weekId, studentId, deployment: process.env.VERCEL_DEPLOYMENT_ID })
      await logExamPhotos(weekId, targets, 'verify', 'failed', 503)
      return err('답안지 사진 파일의 저장을 확인하지 못했습니다. 판독을 시작하지 않았습니다. 사진을 다시 업로드해주세요.', 503)
    }
  } catch {
    await logExamPhotos(weekId, targets, 'verify', 'failed', 503)
    return err('답안지 사진 파일의 저장을 확인하지 못했습니다. 판독을 시작하지 않았습니다. 사진을 다시 업로드해주세요.', 503)
  }

  console.info('[ocr-exam-photo] photo_verified', { weekId, studentId, deployment: process.env.VERCEL_DEPLOYMENT_ID })
  await logExamPhotos(weekId, targets, 'verify', 'succeeded')
  if (storeOnly) {
    if (jobDb) {
      const { error } = await jobDb.from('exam_photo_job_item').update({ photo_path: storagePath, mime_type: imageMime })
        .eq('job_id', jobId).eq('student_id', studentId).is('photo_path', null)
      if (error) return err('저장한 사진을 채점 작업에 연결하지 못했습니다. 다시 시도해 주세요.', 503)
    }
    return ok({ ok: true, photoPath: storagePath })
  }

  const { data: questions } = await supabase
    .from('exam_question')
    .select('question_number, sub_label, question_style, question_stem, question_text, passage, choices, correct_answer_text, source_section, source_question_number, display_order')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')
    .order('question_number')

  if (!questions?.length) {
    await logExamPhotos(weekId, targets, 'ocr', 'failed', 400)
    return err('사진은 저장돼 있습니다. 판독할 문항이 없습니다.')
  }

  const ocrQuestions: ExamOcrQuestion[] = sortQuestionsByPdf(questions).map((q) => ({
    question_number: q.question_number,
    source_section: q.source_section,
    source_question_number: q.source_question_number,
    display_order: q.display_order,
    question_stem: q.question_stem,
    question_text: q.question_text,
    passage: q.passage,
    choices: q.choices,
    sub_label: q.sub_label ?? null,
    question_style: q.question_style as ExamOcrQuestion['question_style'],
    // T/F 판단형 답안지는 모델에게 T/F 로 읽으라고 알려준다 (O/X 로 오인 방지)
    ...(q.question_style === 'ox' && { ox_notation: oxNotation(q.correct_answer_text) }),
  }))

  const lease = new Date(Date.now() + 65_000).toISOString()
  if (jobDb) {
    const { data: claimed, error } = await jobDb.from('exam_photo_job_item').update({ ocr_lease_until: lease })
      .eq('job_id', jobId).eq('student_id', studentId).is('ocr_results', null)
      .or(`ocr_lease_until.is.null,ocr_lease_until.lt.${new Date().toISOString()}`)
      .select('student_id').maybeSingle()
    if (error) return err('답안 인식을 시작하지 못했습니다.', 503)
    if (!claimed) {
      const { data: latest } = await jobDb.from('exam_photo_job_item')
        .select('ocr_results').eq('job_id', jobId).eq('student_id', studentId).single()
      if (Array.isArray(latest?.ocr_results)) return ok({ ok: true, results: latest.ocr_results, photoPath: storagePath })
      return err('이 사진은 인식 중입니다. 잠시 후 다시 확인해 주세요.', 409)
    }
  }

  try {
    const results = await ocrExamAnswers(imageData, imageMime, ocrQuestions)

    if (jobDb) {
      const { data: saved, error } = await jobDb.from('exam_photo_job_item')
        .update({ ocr_results: results, ocr_lease_until: null })
        .eq('job_id', jobId).eq('student_id', studentId).eq('ocr_lease_until', lease)
        .select('student_id').maybeSingle()
      if (error || !saved) return err('인식 결과를 채점 작업에 저장하지 못했습니다. 다시 시도해 주세요.', 503)
    }
    await logExamPhotos(weekId, targets, 'ocr', 'succeeded', 200)
    return ok({ ok: true, results, photoPath: storagePath })
  } catch (e) {
    console.error('[ocr-exam-photo] OCR 실패', e)
    await logExamPhotos(weekId, targets, 'ocr', 'failed', 502)
    return err('사진은 저장됐지만 OCR 판독에 실패했습니다. 저장된 사진으로 재판독하거나 다시 업로드해주세요.', 502)
  } finally {
    if (jobDb) await jobDb.from('exam_photo_job_item').update({ ocr_lease_until: null })
      .eq('job_id', jobId).eq('student_id', studentId).eq('ocr_lease_until', lease)
  }
}
