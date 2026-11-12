import type { CaptureRuntime } from '@/components/grade/capture-runtime'
import { compressImageForUpload } from '@/lib/image-compress'
import type { CapturePhoto } from '@/lib/capture-draft'
import type { GradeRow } from '@/hooks/use-grade'

export const sampleStudents = [
  { student_id: 'sample-dayoung', student_name: '김대영', present: true, hasExisting: false },
  { student_id: 'sample-minseong', student_name: '김민성', present: true, hasExisting: false },
]
export const sampleWeek = 'sample-week'
export const sampleBatchStudents = [
  ...sampleStudents,
  ...Array.from({ length: 13 }, (_, index) => ({
    student_id: `sample-batch-${String(index + 3).padStart(2, '0')}`,
    student_name: `샘플 학생 ${String(index + 3).padStart(2, '0')}`,
    present: true,
    hasExisting: false,
  })),
]

export type SampleBatchStats = { active: number; peak: number; uploads: number; reads: number; grades: number; storedAtFirstRead: number | null; retried: string[] }

export function samplePhoto(name: string, subject = '독해', review = false) {
  const words = ['apple　사과', 'bright　밝은', 'decide　결정하다', 'earth　지구', 'friend　친구']
  const rows = Array.from({ length: 10 }, (_, index) => `<text x="45" y="${175 + index * 46}" font-size="15">${index + 1}　${subject === '단어' ? words[index % words.length] : review && index === 9 ? 'They work together.' : '①　②　③　④　⑤'}</text><path d="M40 ${190 + index * 46}H565" stroke="#e5e8eb"/>`).join('')
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="840" viewBox="0 0 600 840"><rect width="600" height="840" fill="#fff"/><text x="40" y="46" font-family="sans-serif" font-size="19" font-weight="700" fill="#191f28">EduNote · ${subject} 답안지</text><text x="365" y="88" font-family="sans-serif" font-size="17" fill="#6b7684">이름</text><text x="414" y="90" font-family="cursive" font-size="29" fill="#234576" transform="rotate(-3 414 90)">${name}</text><path d="M410 101H560" stroke="#8b95a1"/><path d="M40 125H565" stroke="#191f28"/><g fill="#4e5968" font-family="sans-serif">${rows}</g></svg>`)}`
}

/** The preview supplies its own media and API responses. */
export function createSampleCaptureRuntime(subject: '독해' | '단어', individualId?: string, review = false,
  reportBatch?: (stats: SampleBatchStats) => void): CaptureRuntime & {
    finalizeJob: (jobId: string, rows: GradeRow[]) => void
  } {
  const roster = reportBatch ? sampleBatchStudents : sampleStudents
  const drafts = new Map<string, CapturePhoto[]>()
  const names = new Map<string, string>()
  type SampleResult = { question_number: number; sub_label: null; student_answer?: number; student_answer_text?: string }
  type SampleJob = { id: string; items: {
    student_id: string; photo_path: string | null; mime_type: string | null; ocr_results: SampleResult[] | null; attempts: number
    grade_draft?: GradeRow; grade_draft_revision?: number
  }[] }
  const sampleStorageKey = `edunote:sample-exam-job:${roster.length}`
  let job: SampleJob | null = null
  if (review && typeof sessionStorage !== 'undefined') {
    try { job = JSON.parse(sessionStorage.getItem(sampleStorageKey) ?? 'null') }
    catch { /* The sample can still start a new job. */ }
  }
  function saveJob() {
    try { sessionStorage.setItem(sampleStorageKey, JSON.stringify(job)) }
    catch { /* Keep the in-memory sample. */ }
  }
  const readAttempts = new Map<string, number>()
  let peak = 0
  let uploads = 0
  let reads = 0
  let grades = 0
  let storedAtFirstRead: number | null = null
  const activePhotos = new Set<string>()
  const failedStudentId = sampleBatchStudents[7].student_id
  function report() {
    reportBatch?.({
      active: activePhotos.size, peak, uploads, reads, grades, storedAtFirstRead,
      retried: roster.filter((student) => (readAttempts.get(student.student_id) ?? 0) > 1).map((student) => student.student_name),
    })
  }
  let nextPhoto = 0, revision = 0
  let cameraCanvas: HTMLCanvasElement | null = null
  const currentStudent = () => individualId ?? roster[nextPhoto % roster.length].student_id
  const fileFor = (id: string) => {
    const student = roster.find((entry) => entry.student_id === id)!
    const svg = decodeURIComponent(samplePhoto(student.student_name, subject, review).split(',')[1])
    return new File([svg], `${id}-${subject}.svg`, { type: 'image/svg+xml' })
  }
  async function drawCamera() {
    if (!cameraCanvas) return
    const student = roster.find((entry) => entry.student_id === currentStudent())!
    const image = new Image()
    image.src = samplePhoto(student.student_name, subject, review)
    await image.decode()
    cameraCanvas.getContext('2d')?.drawImage(image, 0, 0, 600, 840)
  }
  return {
    finalizeJob: (jobId, rows) => {
      if (!job || job.id !== jobId) return
      const finalized = new Set(rows.map((row) => row.student_id))
      const items = job.items.filter((item) => !finalized.has(item.student_id))
      job = items.length ? { ...job, items } : null
      saveJob()
    },
    draft: async (key, photos) => {
      if (photos !== undefined) drafts.set(key, photos)
      return drafts.get(key) ?? []
    },
    pickFiles: async (multiple) => multiple ? roster.map((entry) => fileFor(entry.student_id)) : [fileFor(currentStudent())],
    getMedia: async () => {
      cameraCanvas = document.createElement('canvas')
      cameraCanvas.width = 600; cameraCanvas.height = 840
      await drawCamera()
      return cameraCanvas.captureStream(1)
    },
    captureFile: async () => {
      const file = fileFor(currentStudent())
      nextPhoto++
      await drawCamera()
      return file
    },
    compress: async (file, options) => {
      const id = roster.find((entry) => file.name.startsWith(`${entry.student_id}-`))?.student_id
      if (!id) throw new Error('이 화면은 생성된 샘플 사진만 사용합니다.')
      const compressed = await compressImageForUpload(file, options)
      names.set(compressed.base64, id)
      return compressed
    },
    request: async (input, init) => {
      const url = String(input)
      if (url.startsWith('/api/vocab-photo-url?')) {
        const path = new URL(url, 'http://sample.invalid').searchParams.get('path') ?? ''
        const student = roster.find((entry) => path.split('/')[1] === entry.student_id)
        return Response.json({ url: samplePhoto(student?.student_name ?? '샘플 학생', subject) })
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        fileData?: string; studentId?: string; photoPath?: string; storeOnly?: boolean; useStored?: boolean
        preview?: boolean; rows?: GradeRow[]; items?: { number: number; student_answer: string }[]
        jobId?: string; studentIds?: string[]; closeJobId?: string; photoJobId?: string
        revision?: number; answers?: GradeRow['answers']
      }
      if (review && url === `/api/weeks/${sampleWeek}/exam-photo-job`) {
        if (init?.method === 'PATCH') {
          const item = job?.id === body.jobId ? job?.items.find((entry) => entry.student_id === body.studentId) : undefined
          if (!item?.grade_draft || item.grade_draft_revision !== body.revision || !body.answers) {
            return Response.json({ error: '샘플 검토 내용을 저장하지 못했습니다.' }, { status: 409 })
          }
          item.grade_draft = { ...item.grade_draft, answers: body.answers }
          item.grade_draft_revision = body.revision! + 1
          saveJob()
          return Response.json({ revision: item.grade_draft_revision })
        }
        if (init?.method !== 'POST') return Response.json({ job })
        if (body.closeJobId && body.closeJobId === job?.id) {
          job = null
          saveJob()
          return Response.json({ ok: true })
        }
        if (job || !body.studentIds?.length) return Response.json({ error: '진행 중인 샘플 작업을 확인해 주세요.' }, { status: 409 })
        job = { id: `sample-job-${Date.now()}`, items: body.studentIds.map((student_id) => ({
          student_id, photo_path: null, mime_type: null, ocr_results: null, attempts: 0,
        })) }
        saveJob()
        return Response.json({ id: job.id })
      }
      const id = body.studentId ?? names.get(body.fileData ?? '')
      const student = roster.find((entry) => entry.student_id === id)
      if (url === `/api/weeks/${sampleWeek}/vocab-photo-name` && student) {
        return Response.json({ studentId: student.student_id, rawName: student.student_name, confidence: 'high' })
      }
      if (url === `/api/weeks/${sampleWeek}/ocr-exam-photo` && student) {
        const item = job?.id === body.jobId ? job?.items.find((entry) => entry.student_id === student.student_id) : undefined
        const photoPath = `${sampleWeek}/${student.student_id}/${body.jobId ?? 'sample-photo'}`
        if (review && body.storeOnly) {
          if (!item) return Response.json({ error: '샘플 학생의 작업을 찾을 수 없습니다.' }, { status: 404 })
          if (item.photo_path) return Response.json({ ok: true, photoPath: item.photo_path })
          if (reportBatch) await new Promise((resolve) => setTimeout(resolve, 350))
          item.photo_path = photoPath
          item.mime_type = 'image/svg+xml'
          saveJob()
          uploads += 1
          report()
          return Response.json({ ok: true, photoPath })
        }
        if (review && (!body.useStored || !item?.photo_path || job?.items.some((entry) => !entry.photo_path))) {
          return Response.json({ error: '저장된 샘플 사진을 확인하지 못했습니다.' }, { status: 404 })
        }
        if (item?.ocr_results) return Response.json({ ok: true, photoPath, results: item.ocr_results })
        if (review && body.useStored) {
          storedAtFirstRead ??= job?.items.filter((entry) => entry.photo_path).length ?? 0
          activePhotos.add(photoPath)
          peak = Math.max(peak, activePhotos.size)
          const attempts = ++item!.attempts
          readAttempts.set(student.student_id, attempts)
          saveJob()
          reads += 1
          report()
          if (reportBatch) await new Promise((resolve) => setTimeout(resolve, 550))
          activePhotos.delete(photoPath)
          report()
          if (reportBatch && student.student_id === failedStudentId && attempts === 1) {
            return Response.json({ error: '샘플 OCR 실패 · 실패 재시도를 눌러 이 사진만 다시 인식해 보세요.' }, { status: 502 })
          }
        }
        const results = Array.from({ length: 10 }, (_, index) => ({
            question_number: index + 1, sub_label: null,
            ...(review && index === 9 ? { student_answer_text: student === sampleStudents[0] ? 'They work togethcr.' : 'They work together.' } : { student_answer: index % 5 + 1 }),
        }))
        if (item) {
          item.ocr_results = results
          saveJob()
        }
        return Response.json({ ok: true, photoPath, results })
      }
      if (review && url === `/api/weeks/${sampleWeek}/grade` && body.preview && body.rows) {
        grades += 1
        report()
        await new Promise((resolve) => setTimeout(resolve, 700))
        const rows = body.rows.map((row) => ({
          ...row, answers: row.answers.map((answer) => {
            const requiresReview = answer.exam_question_id === 'sample-question-10' && answer.student_answer_text !== 'They work together.'
            return { ...answer, is_correct: !requiresReview, needs_review: requiresReview,
              ai_feedback: requiresReview ? '마지막 단어가 흐립니다. 원본을 확인해 주세요.' : '' }
          }),
        }))
        if (body.photoJobId && job?.id === body.photoJobId) {
          for (const item of job.items) {
            const row = rows.find((entry) => entry.student_id === item.student_id)
            if (row) {
              item.grade_draft = row
              item.grade_draft_revision = 1
            }
          }
          saveJob()
        }
        return Response.json({ rows })
      }
      if (url === `/api/weeks/${sampleWeek}/grade-vocab-photo` && student) {
        return Response.json({ ok: true, vocab_correct: 9, vocab_total: 10, missing_numbers: [],
          results: Array.from({ length: 10 }, (_, index) => ({ number: index + 1, english_word: 'sample', student_answer: '샘플 답', is_correct: index < 9 })) })
      }
      if (url === '/api/vocab-answer' && individualId) {
        return Response.json({ ok: true, versions: [{ student_id: individualId, score_id: `score-${individualId}`, revision: ++revision }], results: body.items ?? [] })
      }
      return Response.json({ error: '샘플 화면에서 허용하지 않는 요청입니다.' }, { status: 400 })
    },
  }
}
