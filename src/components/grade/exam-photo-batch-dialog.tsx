'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { runOrReport } from '@/lib/async-ui'
import { CheckCircle2, ImagePlus, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useCaptureRuntime } from './capture-runtime'
import type { ExamOcrResult } from './exam-photo-button'
import { requireExamPhotoPath } from '@/lib/exam-photo'
import { packExamPhotos } from '@/lib/exam-photo-upload'
import { checkAnswerSheetPages } from '@/lib/answer-sheet-page-check'
import { MobileCapture } from './mobile-capture'
import { ExamStudentConfirmationCard } from './exam-student-confirmation-card'
import { duplicateExamStudents, isExamStudentConfirmed } from '@/lib/exam-student-confirmation'
import type { GradeRow } from '@/hooks/use-grade'
import type { ExamQuestion } from '@/lib/types'
import { ExamBatchReview, ExamRecognitionSummary, needsExamBatchReview } from './exam-batch-review'

type Student = { student_id: string; student_name: string; present: boolean; hasExisting: boolean }

type Confidence = 'high' | 'low' | 'none'
type Phase = 'pick' | 'matching' | 'review' | 'uploading' | 'reading' | 'grading' | 'done' | 'saving'
const PHASE_TITLES: Record<Phase, string> = {
  pick: '답안지 등록', matching: '학생 확인', review: '학생 확인', uploading: '사진 저장 중', reading: '답안 인식',
  grading: '1차 채점 중', done: '답안 인식 결과', saving: '채점 확정 중',
}

type Item = {
  id: string
  previewUrl: string
  /** 압축된 base64 + mime (원본이 아니라 압축본을 보낸다) */
  b64: string | null
  mimeType: string
  studentId: string | null
  confirmedStudentId: string | null
  confidence: Confidence
  rawName: string | null
  /** 동명이인이라 자동 매칭이 거부된 경우 */
  duplicateName: boolean
  codeMatch?: 'matched' | 'unmatched'
  sheetPage?: number
  sheetPages?: (number | null)[]
  pageCount?: number
  isReplacement?: boolean
  status: 'idle' | 'reading-name' | 'ready' | 'reading' | 'done' | 'error'
  error?: string
  photoPath?: string
  ocrResults?: ExamOcrResult[]
  gradeDraft?: GradeRow
  result?: { applied: number; total: number }
}

// 반 정원이 15명 이하라 전 학생 동시 실행 — 학생당 별도 서버 요청이라 서로 안 막힌다.
// LLM 요청 한도에 걸려 개별 실패하면 항목별 오류 + 재시도 버튼으로 복구.
const CONCURRENCY = 15

function pdfPreview(base64: string) {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
}

async function countUploadPages(base64: string, mimeType: string) {
  if (mimeType !== 'application/pdf') return 1
  const { PDFDocument } = await import('pdf-lib')
  const pages = (await PDFDocument.load(base64)).getPageCount()
  if (!pages) throw new Error('빈 PDF입니다. 답안지 페이지가 있는 파일을 추가해 주세요.')
  return pages
}

type PhotoJob = { id: string; items: {
  student_id: string; photo_path: string | null; mime_type: string | null; ocr_results: ExamOcrResult[] | null
  grade_draft: GradeRow | null; grade_draft_revision: number
}[] }

/** 동시 실행 수를 제한하며 순서대로 작업을 돌린다 (worker 는 항목별로 오류를 삼킨다) */
async function runPool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      await worker(items[i], i)
    }
  })
  await Promise.all(runners)
}

type BatchCallbacks = {
  questions: ExamQuestion[]
  prepareOcr: (studentId: string, results: ExamOcrResult[], photoPath: string) => { row: GradeRow; applied: number }
  onFinalize: (rows: GradeRow[], jobId: string) => Promise<void>
  onApplied?: never
} | {
  onApplied: (studentId: string, results: ExamOcrResult[], photoPath: string) => number
  questions?: never
  prepareOcr?: never
  onFinalize?: never
}

export function ExamPhotoBatchDialog({ open, onOpenChange, weekId, students, questionCount, expectedPageCount = 0, onApplied, questions, prepareOcr, onFinalize, statusDetails }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  weekId: string
  students: Student[]
  /** 채점 대상 문항 수 (무효 제외) — 판독 결과 요약 표시용 */
  questionCount: number
  expectedPageCount?: number
  statusDetails?: ReactNode
} & BatchCallbacks) {
  const { request, compress, pickFiles } = useCaptureRuntime()
  const [phase, setPhase] = useState<Phase>('pick')
  const [items, setItems] = useState<Item[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [captureBusy, setCaptureBusy] = useState(false)
  const [gradedRows, setGradedRows] = useState<GradeRow[]>([])
  const [pendingRows, setPendingRows] = useState<GradeRow[]>([])
  const [batchError, setBatchError] = useState('')
  const [acknowledgedPageWarnings, setAcknowledgedPageWarnings] = useState('')
  const [job, setJob] = useState<PhotoJob | null | undefined>(undefined)
  const [jobLoadError, setJobLoadError] = useState('')
  const [jobReload, setJobReload] = useState(0)
  const [reviewWrites, setReviewWrites] = useState(0)
  const [reviewSaveError, setReviewSaveError] = useState('')
  const reviewQueue = useRef(Promise.resolve())
  const draftRevisions = useRef(new Map<string, number>())
  const unsavedReview = useRef(new Map<string, GradeRow>())
  const inputRef = useRef<HTMLInputElement>(null)

  const patch = useCallback((id: string, changes: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes } : it)))
  }, [])

  // 닫힐 때 초기화 — effect 안 setState 대신 렌더 중 조정 (AGENTS.md 패턴).
  const [syncedOpen, setSyncedOpen] = useState<boolean | null>(null)
  if (syncedOpen !== open) {
    setSyncedOpen(open)
    if (!open) {
      setAcknowledgedPageWarnings('')
      items.forEach((it) => URL.revokeObjectURL(it.previewUrl))
      setItems([])
      setPhase('pick')
      setGradedRows([])
      setPendingRows([])
      setBatchError('')
      setJob(undefined)
      setJobLoadError('')
      setReviewSaveError('')
    }
  }
  // 언마운트 시 남은 URL 해제 (vocab 다이얼로그와 같은 이유로 ref 경유)
  const itemsRef = useRef<Item[]>([])
  useEffect(() => { itemsRef.current = items }, [items])
  useEffect(() => () => { itemsRef.current.forEach((it) => URL.revokeObjectURL(it.previewUrl)) }, [])

  const usesJob = !!prepareOcr
  useEffect(() => {
    if (!open || !usesJob) return
    const controller = new AbortController()
    async function loadJob() {
      try {
        const response = await request(`/api/weeks/${weekId}/exam-photo-job`, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('채점 작업을 불러오지 못했습니다.')
        const data = await response.json()
        if (!controller.signal.aborted) {
          draftRevisions.current = new Map(data.job?.items.map((item: PhotoJob['items'][number]) => [item.student_id, item.grade_draft_revision]) ?? [])
          unsavedReview.current.clear()
          setJob(data.job)
          setJobLoadError('')
        }
      } catch {
        if (!controller.signal.aborted) setJobLoadError('채점 작업을 불러오지 못했습니다.')
      }
    }
    void loadJob()
    return () => controller.abort()
  }, [open, usesJob, weekId, request, jobReload])

  const presentStudents = useMemo(() => students.filter((s) => s.present), [students])

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf')
    if (list.length === 0) return
    const fresh: Item[] = list.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      previewUrl: URL.createObjectURL(file),
      b64: null,
      mimeType: file.type,
      studentId: null,
      confirmedStudentId: null,
      confidence: 'none',
      rawName: null,
      duplicateName: false,
      status: 'idle',
    }))
    setItems((prev) => [...prev, ...fresh])
    setPhase('matching')

    // base64 인코딩 + 이름 판독 (병렬)
    await runPool(fresh, CONCURRENCY, async (it, index) => {
      patch(it.id, { status: 'reading-name' })
      await runOrReport(async () => {
        const { base64: b64, mimeType } = await compress(list[index], { forceJpeg: true })
        const pageCount = await countUploadPages(b64, mimeType)
        patch(it.id, { b64, mimeType, pageCount })
        const resp = await request(`/api/weeks/${weekId}/vocab-photo-name`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileData: b64, mimeType, kind: 'reading' }),
        })
        const data = await resp.json() as { studentId: string | null; rawName: string | null; confidence: Confidence; duplicate?: boolean; codeMatch?: Item['codeMatch']; sheetPage?: number; sheetPages?: Item['sheetPages'] }
        const ok = data.studentId && presentStudents.some((s) => s.student_id === data.studentId)
        patch(it.id, {
          studentId: ok ? data.studentId : null,
          confidence: ok ? data.confidence : 'none',
          rawName: data.rawName ?? null,
          duplicateName: data.duplicate ?? false,
          codeMatch: data.codeMatch === 'matched' && !ok ? 'unmatched' : data.codeMatch,
          sheetPage: data.sheetPages?.[0] ?? data.sheetPage,
          sheetPages: data.sheetPages,
          status: 'ready',
        })
      }, () => patch(it.id, { status: 'ready', confidence: 'none' }))
    })
    setPhase('review')
  }

  function removeItem(id: string) {
    setItems((prev) => {
      const target = prev.find((it) => it.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((it) => it.id !== id)
    })
  }

  // 판독이 끝난 뒤 재배정할 때는 이미 처리한 학생의 답안을 덮어쓰지 않는다.
  const duplicateStudentIds = useMemo(() => phase === 'done' ? duplicateExamStudents(items) : new Set<string>(), [items, phase])
  const unmatched = items.filter((it) => !it.studentId).length
  const readyToRead = items.filter((it) => it.studentId && (it.b64 || it.photoPath))
  const photosByStudent = new Map<string, Item[]>()
  for (const item of readyToRead) {
    const pages = photosByStudent.get(item.studentId!)
    if (pages) pages.push(item)
    else photosByStudent.set(item.studentId!, [item])
  }
  const confirmedCount = items.filter((it) => isExamStudentConfirmed(it, duplicateStudentIds)).length
  const allConfirmed = items.length > 0 && confirmedCount === items.length && readyToRead.length === items.length
  const pageWarnings = expectedPageCount > 0 && (phase === 'review' || phase === 'done')
    ? [...photosByStudent].flatMap(([id, files]) => {
      const checked = phase === 'review' ? files : files.filter((file) => file.isReplacement && !file.photoPath)
      if (!checked.length) return []
      const issues = checkAnswerSheetPages(checked, expectedPageCount)
      return issues.length ? [{ id, issues, files: checked.map((file) => file.id) }] : []
    })
    : []
  const pageWarningKey = JSON.stringify(pageWarnings)
  const pageWarningsAccepted = !pageWarnings.length || acknowledgedPageWarnings === pageWarningKey
  const overwriteCount = students.filter((student) => student.hasExisting && photosByStudent.has(student.student_id)).length
  const pendingCodeMatches = readyToRead.filter((item) => item.codeMatch === 'matched' && item.confirmedStudentId !== item.studentId).length

  function confirmCodeMatches() {
    if (phase !== 'review') return
    setItems((current) => current.map((item) => item.codeMatch === 'matched' && item.b64
      ? { ...item, confirmedStudentId: item.studentId } : item))
  }

  const readOne = useCallback(async (it: Item) => {
    patch(it.id, { status: 'reading', error: undefined })
    await runOrReport(async () => {
      const resp = await request(`/api/weeks/${weekId}/ocr-exam-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData: it.b64, mimeType: it.mimeType, studentId: it.studentId }),
      })
      const data = await resp.json()
      if (resp.ok && data.ok) {
        let photoPath: string
        try {
          photoPath = requireExamPhotoPath(weekId, it.studentId!, data.photoPath)
        } catch (error) {
          patch(it.id, { status: 'error', error: error instanceof Error ? error.message : '사진 저장 확인 실패' })
          return
        }
        const applied = onApplied?.(it.studentId!, data.results as ExamOcrResult[], photoPath) ?? 0
        patch(it.id, { status: 'done', result: { applied, total: questionCount } })
      } else {
        patch(it.id, { status: 'error', error: data.error ?? 'OCR 실패' })
      }
    }, () => patch(it.id, { status: 'error', error: '네트워크 오류' }))
  }, [weekId, questionCount, onApplied, patch, request])

  async function post(path: string, payload: unknown, method: 'POST' | 'PATCH' = 'POST') {
    const response = await request(`/api/weeks/${weekId}/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data) {
      throw new Error(data?.error ?? (response.status === 413 ? '사진이 너무 큽니다. 작은 사진으로 다시 시도해 주세요.' : '서버 응답을 확인하지 못했습니다.'))
    }
    return data
  }

  async function gradePreview(targets: GradeRow[], photoJobId?: string): Promise<GradeRow[]> {
    const data = await post('grade', { rows: targets, preview: true, photoJobId })
    if (!Array.isArray(data.rows) || data.rows.length !== targets.length) throw new Error('1차 채점 결과를 확인하지 못했습니다.')
    return data.rows
  }

  async function gradeBatch(jobId: string, targets: GradeRow[]) {
    setPendingRows(targets)
    setPhase('grading')
    setBatchError('')
    try {
      const result = await gradePreview(targets, jobId)
      result.forEach((row) => draftRevisions.current.set(row.student_id, 1))
      setGradedRows((current) => [...current.filter((row) => !result.some((entry) => entry.student_id === row.student_id)), ...result])
      setPendingRows([])
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : '1차 채점에 실패했습니다.')
    } finally {
      setPhase('done')
    }
  }

  async function processBatch(jobId: string, targets: Item[]) {
    const waitingForUpload = targets.filter((item) => !item.photoPath)
    const stored = targets.filter((item) => item.photoPath)
    setBatchError('')
    if (waitingForUpload.length) {
      setPhase('uploading')
      await runPool(waitingForUpload, CONCURRENCY, async (item) => {
        const studentId = item.studentId!
        patch(item.id, { status: 'ready', error: undefined })
        try {
          const result = await post('ocr-exam-photo', { jobId, studentId, fileData: item.b64, mimeType: item.mimeType, storeOnly: true })
          const photoPath = requireExamPhotoPath(weekId, studentId, result.photoPath)
          stored.push({ ...item, photoPath })
          patch(item.id, { photoPath })
        } catch (error) {
          patch(item.id, { status: 'error', error: error instanceof Error ? error.message : '사진 저장에 실패했습니다.' })
        }
      })
      if (stored.length !== targets.length) {
        setBatchError('저장에 실패한 사진이 있습니다. 실패 재시도로 저장을 마치면 답안 인식을 시작합니다.')
        setPhase('done')
        return
      }
    }

    setPhase('reading')
    const drafts: GradeRow[] = []
    await runPool(stored, CONCURRENCY, async (item) => {
      const studentId = item.studentId!
      const photoPath = item.photoPath!
      patch(item.id, { status: 'reading', error: undefined })
      try {
        if (!item.previewUrl) {
          // A recovered photo is already in Storage. Preview failure must not block OCR.
          void request(`/api/vocab-photo-url?bucket=exam-photos&path=${encodeURIComponent(photoPath)}`)
            .then((response) => response.json())
            .then((data) => { if (typeof data.url === 'string') patch(item.id, { previewUrl: data.url }) })
            .catch(() => {})
        }
        if (item.gradeDraft) {
          patch(item.id, { status: 'done', result: { applied: item.ocrResults?.length ?? questionCount, total: questionCount } })
          return
        }
        const results = item.ocrResults ?? (await post('ocr-exam-photo', { jobId, studentId, useStored: true })).results
        if (!Array.isArray(results)) throw new Error('인식한 답안을 확인하지 못했습니다.')
        const { row, applied } = prepareOcr!(studentId, results, photoPath)
        drafts.push(row)
        patch(item.id, { status: 'done', ocrResults: results, result: { applied, total: questionCount } })
      } catch (error) {
        const reason = error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.'
        patch(item.id, { status: 'error', error: `사진 저장됨 · ${reason}` })
      }
    })
    if (drafts.length) await gradeBatch(jobId, drafts)
    else setPhase('done')
  }

  function resumeBatch() {
    if (!job || phase !== 'pick' || captureBusy) return
    const recovered: Item[] = job.items.map((photo) => ({
      id: photo.student_id, photoPath: photo.photo_path ?? undefined, ocrResults: photo.ocr_results ?? undefined,
      gradeDraft: photo.grade_draft ?? undefined,
      studentId: photo.student_id, confirmedStudentId: photo.student_id,
      mimeType: photo.mime_type ?? 'image/jpeg', previewUrl: '', b64: null, rawName: null, confidence: 'none',
      duplicateName: false, status: photo.photo_path ? 'ready' : 'error',
      error: photo.photo_path ? undefined : '저장되지 않은 사진을 다시 추가해 주세요.',
    }))
    setItems(recovered)
    setGradedRows(job.items.flatMap((item) => item.grade_draft ? [item.grade_draft] : []))
    if (recovered.every((photo) => photo.photoPath)) void processBatch(job.id, recovered)
    else setPhase('done')
  }

  async function attachMissingPhoto(item: Item, files: File[]) {
    setCaptureBusy(true)
    try {
      const { base64, mimeType } = await packExamPhotos(await Promise.all(files.map((file) => compress(file, { forceJpeg: true }))))
      const pageCount = await countUploadPages(base64, mimeType)
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      patch(item.id, { b64: base64, mimeType, pageCount, isReplacement: true, previewUrl: files.length === 1 ? URL.createObjectURL(files[0]) : pdfPreview(base64), error: '사진 추가됨 · 실패 재시도로 저장하세요.' })
    } catch (error) {
      patch(item.id, { error: error instanceof Error ? error.message : '사진을 읽지 못했습니다. 다른 파일을 선택해 주세요.' })
    } finally {
      setCaptureBusy(false)
    }
  }

  async function startReading() {
    if (phase !== 'review' || !allConfirmed || !pageWarningsAccepted) return
    if (prepareOcr && job !== null) return
    setPhase('uploading')
    setBatchError('')
    try {
      const targets: Item[] = []
      for (const pages of photosByStudent.values()) {
        const first = pages[0]
        if (pages.length === 1) {
          targets.push(first)
        } else {
          const pageNumbers = new Set(pages.map((page) => page.sheetPage))
          const orderedPages = pages.every((page) => (page.pageCount ?? 1) === 1) && pageNumbers.size === pages.length && !pageNumbers.has(undefined)
            ? [...pages].sort((a, b) => a.sheetPage! - b.sheetPage!) : pages
          const { base64, mimeType } = await packExamPhotos(orderedPages.map((page) => ({ base64: page.b64!, mimeType: page.mimeType })))
          targets.push({ ...first, id: `${first.id}:pdf`, b64: base64, mimeType, previewUrl: '' })
        }
      }
      const newJob = prepareOcr ? await post('exam-photo-job', { studentIds: targets.map((item) => item.studentId) }) : null
      const targetIds = new Set(targets.map((item) => item.id))
      for (const item of items) {
        if (!targetIds.has(item.id)) URL.revokeObjectURL(item.previewUrl)
      }
      const uploads = targets.map((item) => item.previewUrl ? item : { ...item, previewUrl: pdfPreview(item.b64!) })
      setItems(uploads)
      if (newJob) {
        setJob({ id: newJob.id, items: [] })
        await processBatch(newJob.id, uploads)
      } else {
        setPhase('reading')
        await runPool(uploads, CONCURRENCY, readOne)
        setPhase('done')
      }
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : '채점 작업을 시작하지 못했습니다.')
      setPhase('review')
    }
  }

  async function retryFailed() {
    if (phase !== 'done' || pendingRows.length > 0 || !pageWarningsAccepted) return
    const failed = items.filter((it) => it.status === 'error' && (it.b64 || it.photoPath) && isExamStudentConfirmed(it, duplicateStudentIds))
    if (failed.length === 0) return
    if (prepareOcr) {
      if (job && allConfirmed) await processBatch(job.id, [...failed, ...items.filter((it) => it.status === 'ready' && it.photoPath)])
      return
    }
    setPhase('reading')
    await runPool(failed, CONCURRENCY, readOne)
    setPhase('done')
  }

  const doneCount = items.filter((it) => it.status === 'done').length
  const errorCount = items.filter((it) => it.status === 'error').length
  const isBusy = captureBusy || phase === 'matching' || phase === 'uploading' || phase === 'reading' || phase === 'grading' || phase === 'saving'
  const remainingReview = gradedRows.reduce((count, row) => count + row.answers.filter((answer) => needsExamBatchReview(answer, questions)).length, 0)
  const keepOpen = !!prepareOcr && open && (isBusy || reviewWrites > 0 || !!reviewSaveError)
  const canAddPhotos = !prepareOcr || job === null

  useEffect(() => {
    if (!keepOpen) return
    function preventLeaving(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventLeaving)
    return () => window.removeEventListener('beforeunload', preventLeaving)
  }, [keepOpen])

  async function finalize() {
    if (!onFinalize || !job || isBusy || !gradedRows.length || remainingReview || pendingRows.length || reviewWrites || reviewSaveError) return
    if (errorCount && !window.confirm(`처리 실패 ${errorCount}명을 제외하고 ${gradedRows.length}명만 확정할까요?`)) return
    setPhase('saving')
    setBatchError('')
    try {
      await onFinalize(gradedRows, job.id)
      onOpenChange(false)
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : '채점 확정에 실패했습니다. 다시 시도해 주세요.')
      setPhase('done')
    }
  }

  async function closeJob() {
    if (!job || !window.confirm('진행 중인 작업을 종료할까요? 저장된 사진은 보관됩니다.')) return
    setPhase('saving')
    setBatchError('')
    try {
      await post('exam-photo-job', { closeJobId: job.id })
      setJob(null)
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : '채점 작업을 종료하지 못했습니다.')
    } finally {
      setPhase('pick')
    }
  }

  function persistReview(row: GradeRow) {
    if (!job) return
    unsavedReview.current.set(row.student_id, row)
    setReviewWrites((count) => count + 1)
    reviewQueue.current = reviewQueue.current.then(async () => {
      // A newer edit replaces queued snapshots that have not started yet.
      if (unsavedReview.current.get(row.student_id) !== row) return
      try {
        const { revision } = await post('exam-photo-job', {
          jobId: job.id, studentId: row.student_id, revision: draftRevisions.current.get(row.student_id), answers: row.answers,
        }, 'PATCH')
        if (!Number.isSafeInteger(revision)) throw new Error('검토 내용의 저장을 확인하지 못했습니다.')
        draftRevisions.current.set(row.student_id, revision)
        if (unsavedReview.current.get(row.student_id) === row) unsavedReview.current.delete(row.student_id)
        if (!unsavedReview.current.size) setReviewSaveError('')
      } catch (error) {
        setReviewSaveError(error instanceof Error ? error.message : '검토 내용을 저장하지 못했습니다.')
      }
    }).finally(() => setReviewWrites((count) => count - 1))
  }

  function replaceReviewRow(row: GradeRow) {
    setGradedRows((current) => current.map((entry) => entry.student_id === row.student_id ? row : entry))
    persistReview(row)
  }

  function updateReviewAnswer(studentId: string, questionId: string, changes: Partial<GradeRow['answers'][number]>) {
    const row = gradedRows.find((entry) => entry.student_id === studentId)
    if (!row) return
    replaceReviewRow({ ...row, answers: row.answers.map((answer) =>
      answer.exam_question_id === questionId ? { ...answer, ...changes } : answer) })
  }

  async function regrade(row: GradeRow, question: ExamQuestion) {
    if (isBusy) return
    const questionIds = new Set(questions?.filter((candidate) => candidate.id === question.id ||
      (question.question_style === 'find_error' && candidate.question_style === 'find_error' &&
        candidate.question_number === question.question_number)).map((candidate) => candidate.id))
    setPhase('grading')
    setBatchError('')
    try {
      const [result] = await gradePreview([{ ...row, answers: row.answers.filter((answer) => questionIds.has(answer.exam_question_id)) }])
      const regraded = new Map(result.answers.map((answer) => [answer.exam_question_id, answer]))
      replaceReviewRow({ ...row, answers: row.answers.map((answer) => regraded.get(answer.exam_question_id) ?? answer) })
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : '다시 채점하지 못했습니다.')
    } finally {
      setPhase('done')
    }
  }

  /** 닫기 요청 처리 — vocab 다이얼로그와 같은 규칙 */
  function requestClose() {
    if (isBusy || reviewWrites) return
    if (job) {
      if (reviewSaveError && !window.confirm('저장하지 못한 수정이 있습니다. 창을 닫을까요?')) return
      onOpenChange(false)
      return
    }
    const pendingCount = items.filter((it) => it.status !== 'done').length
    if (items.length > 0 && pendingCount > 0) {
      const msg = phase === 'done'
        ? `인식하지 못한 답안지 ${errorCount}장이 있습니다. 완료된 ${doneCount}명의 답안은 유지됩니다.\n창을 닫으시겠습니까?`
        : `창을 닫으면 답안지 ${items.length}장의 학생 확인이 초기화됩니다.\n닫으시겠습니까?`
      if (!window.confirm(msg)) return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) requestClose(); else onOpenChange(v) }}>
      <DialogContent
        className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] rounded-[20px] shadow-none sm:max-w-2xl overflow-hidden p-0"
        showCloseButton={false}
        onEscapeKeyDown={(event) => { if (isBusy) event.preventDefault() }}
        onInteractOutside={(event) => { if (isBusy) event.preventDefault() }}
      >
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="text-base">{prepareOcr && phase === 'done' ? (remainingReview ? '서술형 검토' : '독해 채점 결과') : PHASE_TITLES[phase]}</DialogTitle>
          <DialogDescription className="text-xs text-gray-500">
            {phase === 'pick' && '답안지를 촬영하거나 사진을 추가해 주세요.'}
            {phase === 'matching' && '답안지의 이름과 판독 코드를 확인하고 있습니다.'}
            {phase === 'review' && '각 답안지의 학생을 확인해 주세요. 여러 페이지는 같은 학생을 선택하면 합쳐집니다.'}
            {phase === 'uploading' && '학생별 사진을 먼저 저장하고 있어요.'}
            {phase === 'reading' && (prepareOcr ? '저장된 사진에서 답안을 인식하고 있어요.' : '답안을 인식하고 있습니다.')}
            {phase === 'grading' && '답안을 채점하고 있어요. 이 화면을 열어 두세요.'}
            {phase === 'saving' && '검토한 결과를 학생 기록에 저장하고 있어요.'}
            {phase === 'done' && (prepareOcr
              ? `1차 채점 ${gradedRows.length}명${remainingReview ? ` · 검토 필요 ${remainingReview}문항` : ''}${errorCount ? ` · 사진 처리 실패 ${errorCount}명` : ''}`
              : `${doneCount}명 답안 인식 완료${errorCount > 0 ? ` · ${errorCount}명 인식 실패` : ''}. 답안을 검토한 후 채점을 저장해 주세요.`)}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-5">
          {statusDetails}
          {prepareOcr && (phase === 'uploading' || phase === 'reading' || phase === 'grading' || phase === 'saving') && (
            <div role="status" className="mb-4 flex items-center gap-3 rounded-xl border bg-card p-4 text-sm">
              <Loader2 className="size-5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
              {phase === 'uploading' ? `사진 저장 ${items.filter((item) => item.photoPath).length} / ${items.length}장`
                : phase === 'reading' ? `사진 처리 ${doneCount + errorCount} / ${items.length}장` : PHASE_TITLES[phase]}
            </div>
          )}
          {batchError && <p role="alert" className="mb-4 break-words text-sm text-[var(--share-red)]">{batchError}</p>}
          {reviewSaveError && <div role="alert" className="mb-4 space-y-2 text-sm text-[var(--share-red)]">
            <p>{reviewSaveError}</p>
            <Button variant="outline" disabled={reviewWrites > 0 || isBusy} onClick={() => unsavedReview.current.forEach(persistReview)}>검토 저장 재시도</Button>
          </div>}
          {gradedRows.length > 0 && !reviewSaveError && <p role="status" className="mb-3 text-xs text-[var(--share-body)]">
            {reviewWrites ? '검토 내용 저장 중' : '검토 내용 저장됨'}
          </p>}
          {prepareOcr && phase === 'pick' && job === undefined && (
            jobLoadError ? <div role="alert" className="space-y-2 text-sm">
              <p>{jobLoadError}</p>
              <Button variant="outline" onClick={() => setJobReload((value) => value + 1)}>다시 확인</Button>
            </div> : <p role="status" className="text-sm">진행 중인 채점 작업 확인 중</p>
          )}
          {phase === 'pick' && job && (
            <div className="mb-4 space-y-2">
              <Button variant="outline" className="min-h-11 w-full" disabled={captureBusy} onClick={resumeBatch}>
                채점 작업 {job.items.length}장 이어서 처리
              </Button>
              <Button variant="ghost" className="min-h-11" onClick={closeJob}>작업 종료</Button>
            </div>
          )}
          <MobileCapture key={`exam:${weekId}`} draftKey={`exam:${weekId}`} active={open && phase === 'pick' && canAddPhotos} onConfirm={addFiles} onBusyChange={setCaptureBusy} />
          {/* 파일 넣기 영역 */}
          {canAddPhotos && (phase === 'pick' || phase === 'review') && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
              onClick={async () => { if (pickFiles) await addFiles(await pickFiles(true)); else inputRef.current?.click() }}
              className={cn(
                'mb-4 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed py-6 transition-colors',
                dragOver ? 'border-indigo-400 bg-indigo-50/60' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/60'
              )}
            >
              <ImagePlus className="h-5 w-5 text-gray-400" />
              <p className="text-xs text-gray-500">답안지 사진 추가 · 여러 장 선택 가능</p>
              <input
                ref={inputRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
              />
            </div>
          )}

          {/* 항목 목록 */}
          {items.length > 0 && (!prepareOcr || phase === 'matching' || !isBusy) && (
            <ul className="space-y-2">
              {items.map((it, index) => {
                if (prepareOcr && phase === 'done' && it.status === 'done') return null
                const student = students.find((s) => s.student_id === it.studentId)
                const isDupPhoto = !!it.studentId && duplicateStudentIds.has(it.studentId)
                const previous = items[index - 1]
                const previousStudent = phase === 'review' && !it.studentId && !it.codeMatch && !it.duplicateName && it.b64 && previous?.confirmedStudentId
                  ? presentStudents.find((s) => s.student_id === previous.confirmedStudentId) : undefined
                return (
                  <li key={it.id}>
                    <ExamStudentConfirmationCard
                      number={index + 1}
                      previewUrl={it.previewUrl}
                      mimeType={it.mimeType}
                      studentId={it.studentId}
                      students={presentStudents}
                      rawName={it.rawName}
                      confirmed={isExamStudentConfirmed(it, duplicateStudentIds)}
                      duplicate={isDupPhoto}
                      disabled={isBusy || it.status === 'done' || !!job}
                      onStudentChange={(studentId) => patch(it.id, { studentId, confirmedStudentId: null, codeMatch: undefined })}
                      onConfirm={() => {
                        if ((phase === 'review' || phase === 'done') && it.studentId && !isDupPhoto) patch(it.id, { confirmedStudentId: it.studentId })
                      }}
                      onRemove={() => removeItem(it.id)}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        {it.status === 'reading-name' && <span className="text-[var(--share-muted)]">이름 인식 중</span>}
                        {prepareOcr && it.status === 'ready' && !it.b64 && <span role="alert" className="text-[var(--share-red)]">파일을 읽지 못했습니다. 이 사진을 제외한 뒤 다시 추가해 주세요.</span>}
                        {it.duplicateName && <span className="text-[var(--share-muted)]">동명이인입니다. 학생을 직접 선택해 주세요.</span>}
                        {it.codeMatch === 'matched' && <span className="text-[var(--share-body)]">판독 코드 일치</span>}
                        {phase === 'review' && (it.sheetPages?.length || it.sheetPage) && (
                          <span className="text-[var(--share-body)]">인쇄 쪽수 {it.sheetPages?.length
                            ? it.sheetPages.map((page) => page ? `${page}쪽` : '확인 필요').join(', ')
                            : `${it.sheetPage}쪽`}</span>
                        )}
                        {it.codeMatch === 'unmatched' && <span className="text-[var(--share-red)]">판독 코드와 명단이 일치하지 않습니다. 답안지를 확인해 주세요.</span>}
                        {phase === 'review' && it.studentId && (photosByStudent.get(it.studentId)?.length ?? 0) > 1 && (
                          <span className="text-[var(--share-body)]">{student?.student_name} 답안지 {photosByStudent.get(it.studentId)?.length}장으로 합칩니다.</span>
                        )}
                        {it.status === 'reading' && <><Loader2 className="size-3.5 animate-spin" /><span>답안 인식 중</span></>}
                        {it.status === 'done' && it.result && <><CheckCircle2 className="size-3.5 text-[var(--share-blue)]" /><span>{it.result.applied}/{it.result.total}문항 반영</span></>}
                        {it.status === 'error' && <><XCircle className="size-3.5 shrink-0 text-[var(--share-red)]" /><span role="alert" className="text-[var(--share-red)]">{it.error}</span></>}
                        {student?.hasExisting && it.status === 'ready' && <span className="text-[var(--share-muted)]">기존 답안을 새 인식 결과로 변경합니다</span>}
                      </div>
                      {previousStudent && (
                        <Button type="button" size="sm" variant="outline" className="mt-2 min-h-11" onClick={() => patch(it.id, {
                          studentId: previousStudent.student_id, confirmedStudentId: previousStudent.student_id,
                        })}>앞 사진과 같은 학생 · {previousStudent.student_name}</Button>
                      )}
                      {job && phase === 'done' && !it.photoPath && !it.b64 && (
                        <label className="block pt-2 text-sm">
                          {student?.student_name} 사진 다시 추가
                          <input type="file" multiple className="block max-w-full py-2" accept="image/*,application/pdf" disabled={isBusy}
                            onChange={(event) => {
                              const files = Array.from(event.target.files ?? [])
                              if (files.length) void attachMissingPhoto(it, files)
                            }} />
                        </label>
                      )}
                    </ExamStudentConfirmationCard>
                  </li>
                )
              })}
            </ul>
          )}
          {pageWarnings.length > 0 && (
            <section className="space-y-1 rounded-xl bg-[var(--share-red-bg)] px-4 py-3 text-sm text-[var(--share-red-deep)]">
              <h3 className="font-semibold">답안지 쪽수를 확인해 주세요</h3>
              <ul aria-live="polite" className="space-y-1">
                {pageWarnings.map(({ id, issues }) => (
                  <li key={id}>{students.find((student) => student.student_id === id)?.student_name} · {issues.join(' · ')}</li>
                ))}
              </ul>
              <label className="flex min-h-11 items-center gap-2 font-medium">
                <input type="checkbox" checked={pageWarningsAccepted} onChange={(event) => setAcknowledgedPageWarnings(event.target.checked ? pageWarningKey : '')} />
                원본을 확인했고 현재 답안지로 계속합니다
              </label>
            </section>
          )}
          {questions && gradedRows.length > 0 && (
            <>
              <ExamRecognitionSummary rows={gradedRows} questions={questions} photos={items} />
              <ExamBatchReview
                rows={gradedRows}
                questions={questions}
                previews={new Map(items.flatMap((item) => item.studentId ? [[item.studentId, item.previewUrl]] : []))}
                busy={isBusy}
                onEdit={(studentId, questionId, student_answer_text) => updateReviewAnswer(studentId, questionId, { student_answer_text, ai_feedback: '' })}
                onVerdict={(studentId, questionId, is_correct) => updateReviewAnswer(studentId, questionId, { is_correct, teacher_confirmed: true, needs_review: false })}
                onRegrade={regrade}
              />
            </>
          )}
        </div>

        {/* 하단 액션 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          <p aria-live="polite" className="text-xs text-[var(--share-body)]">
            {items.length > 0 && `${confirmedCount} / ${items.length}장 확인`}
            {unmatched > 0 && ` · 학생 미선택 ${unmatched}장`}
            {pageWarnings.length > 0 && ` · 쪽수 확인 ${pageWarnings.length}명`}
            {overwriteCount > 0 && ` · 기존 답안 변경 ${overwriteCount}명`}
            {duplicateStudentIds.size > 0 && ` · 같은 학생 중복 ${duplicateStudentIds.size}명`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {phase === 'review' && pendingCodeMatches > 0 && (
              <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={confirmCodeMatches} disabled={isBusy}>
                코드 일치 {pendingCodeMatches}장 확인
              </Button>
            )}
            <Button variant="outline" size="sm" className={prepareOcr ? 'min-h-11' : undefined} onClick={requestClose} disabled={isBusy || reviewWrites > 0}>
              {phase === 'done' ? '닫기' : '취소'}
            </Button>
            {phase === 'done' && errorCount > 0 && pendingRows.length === 0 && (
              <Button size="sm" variant="outline" className={prepareOcr ? 'min-h-11' : undefined} onClick={retryFailed} disabled={isBusy || !allConfirmed || !pageWarningsAccepted}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> 실패 재시도
              </Button>
            )}
            {job && phase === 'done' && pendingRows.length > 0 && (
              <Button size="sm" variant="action" className="min-h-11" onClick={() => gradeBatch(job.id, pendingRows)}>1차 채점 재시도</Button>
            )}
            {onFinalize && (phase === 'done' || phase === 'saving') && gradedRows.length > 0 && pendingRows.length === 0 && (
              <Button size="sm" variant="action" className="min-h-11" disabled={isBusy || remainingReview > 0 || reviewWrites > 0 || !!reviewSaveError} onClick={finalize}>
                {errorCount ? `${gradedRows.length}명만 확정` : `${gradedRows.length}명 일괄 확정`}
              </Button>
            )}
            {(phase === 'matching' || phase === 'review' || phase === 'reading' || (phase === 'pick' && canAddPhotos)) && (
              <Button size="sm" variant="action" className={prepareOcr ? 'min-h-11' : undefined} onClick={startReading} disabled={isBusy || !allConfirmed || !pageWarningsAccepted}>
                {phase === 'reading' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                {items.length > 0 ? `${photosByStudent.size + items.length - readyToRead.length}명 ` : ''}{prepareOcr ? '답안 인식 및 채점' : '답안 인식'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
