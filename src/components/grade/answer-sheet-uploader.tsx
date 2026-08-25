'use client'

import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import { errorMessage, runOrReport } from '@/lib/async-ui'
import { mapWithConcurrency } from '@/lib/concurrency'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileCheck,
  FileText,
  ListOrdered,
  Loader2,
  Upload,
  X,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useUploadStore, type AnswerSheetStatus } from '@/store/upload-store'

const IDLE_STATUS: AnswerSheetStatus = { type: 'idle' }

const ANSWER_STEPS = [
  { label: '해설지를 읽는 중입니다.', sub: 'PDF 구조와 정답 표기를 확인하고 있습니다.' },
  { label: '정답을 추출하고 있습니다.', sub: '문항별 정답과 해설을 구조화하고 있습니다.' },
  { label: '기존 채점 결과를 갱신하고 있습니다.', sub: '저장된 학생 답안을 새 정답 기준으로 다시 계산하고 있습니다.' },
]

type AnswerParseMode = 'auto' | 'answer_sheet'

// 문제지형 청크 파싱 동시 요청 수 — 실측(44p, 청크 11): 동시 6 LLM 콜에서 스로틀 없이 2.5배 단축.
// 서버 함수가 청크당 1개씩 뜨므로 Vercel 동시 실행 여유와 맞바꾸는 값.
const CHUNK_REQUEST_CONCURRENCY = 4

type LocalStatus =
  | { type: 'idle' }
  | { type: 'loading'; message: string; processedCount?: number; totalCount?: number }
  | { type: 'done'; message: string; questionsParsed?: number; studentsRegraded?: number; generatedCount?: number; subjectiveGradingFailed?: boolean }
  | { type: 'error'; message: string }

type PendingUploadAction = 'standard' | 'problem' | null
type UploadAsset = { id: string; file: File }
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

interface Props {
  weekId: string
  savedFilePath?: string | null
  readingTotal?: number
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function buildUploadAssets(fileList: FileList | null): UploadAsset[] {
  return Array.from(fileList ?? []).map((file, index) => ({
    id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
    file,
  }))
}

function safeStorageName(fileName: string) {
  return fileName
    .replace(/[^\x00-\x7F]/g, '_')
    .replace(/[/\\?%*:|"<>\s]/g, '_')
    .replace(/_+/g, '_')
}

async function resizeImageToBlob(file: File, maxPx = 2000, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      const width = Math.round(img.width * scale)
      const height = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')?.drawImage(img, 0, 0, width, height)
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('이미지 변환에 실패했습니다.')), 'image/jpeg', quality)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('이미지 파일을 읽지 못했습니다.'))
    }
    img.src = url
  })
}

async function imagesToPdf(files: File[]): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib')
  const pdfDoc = await PDFDocument.create()

  for (const file of files) {
    const resized = await resizeImageToBlob(file)
    const imageBytes = await resized.arrayBuffer()
    const pdfImage = await pdfDoc.embedJpg(imageBytes)
    const page = pdfDoc.addPage([pdfImage.width, pdfImage.height])
    page.drawImage(pdfImage, { x: 0, y: 0, width: pdfImage.width, height: pdfImage.height })
  }

  const bytes = await pdfDoc.save()
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
}

async function prepareUploadBlob(files: UploadAsset[], purpose: string) {
  const rawFiles = files.map((asset) => asset.file)
  const pdfFiles = rawFiles.filter((file) => file.type === 'application/pdf')
  const imageFiles = rawFiles.filter((file) => IMAGE_TYPES.includes(file.type))

  if (pdfFiles.length > 0 && rawFiles.length > 1) {
    throw new Error('PDF는 1개만 선택하거나, 이미지 여러 장만 선택해주세요.')
  }

  if (pdfFiles.length === 1) {
    return {
      blob: pdfFiles[0],
      mimeType: 'application/pdf',
      fileName: pdfFiles[0].name,
    }
  }

  if (imageFiles.length !== rawFiles.length) {
    throw new Error('PDF, JPG, PNG, WEBP 파일만 업로드할 수 있습니다.')
  }

  const blob = await imagesToPdf(imageFiles)
  return {
    blob,
    mimeType: 'application/pdf',
    fileName: `${purpose}-${Date.now()}.pdf`,
  }
}

async function uploadFilesToTempStorage(files: UploadAsset[], weekId: string, purpose: string) {
  const prepared = await prepareUploadBlob(files, purpose)
  const presignResponse = await fetch(`/api/weeks/${weekId}/import-upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: safeStorageName(prepared.fileName) }),
  })

  if (!presignResponse.ok) {
    const data = await presignResponse.json().catch(() => ({ error: '업로드 URL 발급에 실패했습니다.' }))
    throw new Error(String(data.error ?? '업로드 URL 발급에 실패했습니다.'))
  }

  const { uploadUrl, path } = await presignResponse.json() as { uploadUrl: string; path: string }
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': prepared.mimeType },
    body: prepared.blob,
  })

  if (!uploadResponse.ok) {
    throw new Error('파일 업로드에 실패했습니다.')
  }

  return [{
    storagePath: path,
    mimeType: prepared.mimeType,
    fileName: prepared.fileName,
  }]
}

function moveUploadAsset(files: UploadAsset[], fromIndex: number, direction: -1 | 1) {
  const toIndex = fromIndex + direction
  if (toIndex < 0 || toIndex >= files.length) return files

  const next = [...files]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

function parseJsonSafely(raw: string): Record<string, unknown> {
  try {
    return raw ? JSON.parse(raw) as Record<string, unknown> : {}
  } catch {
    return { error: raw || '서버가 JSON이 아닌 응답을 반환했습니다.' }
  }
}

function AnswerParseProgress({ elapsed, processedCount, totalCount, message }: {
  elapsed: number
  processedCount?: number
  totalCount?: number
  message?: string
}) {
  const chunkProgress = typeof processedCount === 'number' && typeof totalCount === 'number' && totalCount > 0
    ? { processed: processedCount, total: totalCount }
    : null
  const idx = elapsed < 10 ? 0 : elapsed < 30 ? 1 : 2
  const current = chunkProgress
    ? {
      label: chunkProgress.processed >= chunkProgress.total
        ? (message ?? '결과를 합쳐 저장하고 있습니다.')
        : `${message ?? '파싱하고 있습니다.'} (${chunkProgress.processed}/${chunkProgress.total} 구간)`,
      sub: '문서를 구간으로 나눠 병렬로 읽고 있습니다. 구간별로 완료되는 대로 진행률이 올라갑니다.',
    }
    : (message ? { label: message, sub: ANSWER_STEPS[idx].sub } : ANSWER_STEPS[idx])
  const progress = chunkProgress
    ? Math.min((chunkProgress.processed / chunkProgress.total) * 100, 95)
    : Math.min((elapsed / 90) * 100, 95)

  return (
    <div className="space-y-3 rounded-[20px] bg-blue-50/90 p-4 text-blue-900 shadow-[0_10px_40px_rgba(0,75,198,0.06)] dark:bg-slate-900/80 dark:text-slate-100">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{current.label}</p>
        <span className="text-xs text-blue-700 dark:text-slate-300">{elapsed}초</span>
      </div>
      <p className="text-xs text-blue-700 dark:text-slate-300">{current.sub}</p>
      <div className="h-1.5 w-full rounded-full bg-blue-200 dark:bg-slate-700">
        <div
          className="h-1.5 rounded-full bg-blue-600 transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}

function FileDropzone(props: {
  file: File | null
  inputRef: RefObject<HTMLInputElement | null>
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  accept: string
  idleLabel: string
  multiple?: boolean
}) {
  const { file, inputRef, onChange, accept, idleLabel, multiple = false } = props

  return (
    <div
      onClick={() => inputRef.current?.click()}
      className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[24px] bg-slate-50/90 px-4 py-8 text-center transition hover:bg-slate-100/90 dark:bg-slate-900/60 dark:hover:bg-slate-900/80"
    >
      {file ? (
        <>
          <FileText className="h-8 w-8 text-blue-600 dark:text-blue-400" />
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{file.name}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">다른 파일로 바꾸려면 다시 클릭하세요.</p>
        </>
      ) : (
        <>
          <Upload className="h-8 w-8 text-slate-300 dark:text-slate-500" />
          <p className="text-sm text-slate-500 dark:text-slate-400">{idleLabel}</p>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={onChange}
      />
    </div>
  )
}

function OrderedFileList(props: {
  files: UploadAsset[]
  onMove: (index: number, direction: -1 | 1) => void
  onRemove: (index: number) => void
}) {
  const { files, onMove, onRemove } = props

  return (
    <div className="space-y-2">
      {files.map((asset, index) => (
        <div
          key={asset.id}
          className="flex items-center gap-3 rounded-[18px] bg-slate-50/90 px-3 py-3 text-sm text-slate-700 dark:bg-slate-900/70 dark:text-slate-200"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700 dark:bg-slate-800 dark:text-blue-300">
            {index + 1}
          </div>
          <FileText className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{asset.file.name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {asset.file.type.startsWith('image/') ? '이미지' : 'PDF'} · 페이지 순서 {index + 1}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => onMove(index, -1)} disabled={index === 0}>
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => onMove(index, 1)} disabled={index === files.length - 1}>
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-full text-red-500 hover:text-red-600" onClick={() => onRemove(index)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

function StatusBanner({ status }: { status: AnswerSheetStatus | LocalStatus }) {
  if (status.type === 'idle') return null

  if (status.type === 'loading') {
    const message = 'message' in status ? status.message : status.step
    return (
      <div className="rounded-[18px] bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
        {message}
      </div>
    )
  }

  if (status.type === 'error') {
    return (
      <div className="flex items-start gap-2 rounded-[18px] bg-red-50 px-4 py-3 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{status.message}</p>
      </div>
    )
  }

  const questionsParsed = 'questionsParsed' in status
    ? status.questionsParsed
    : ('questions_parsed' in status ? status.questions_parsed : undefined)
  const studentsRegraded = 'studentsRegraded' in status
    ? status.studentsRegraded
    : ('students_regraded' in status ? status.students_regraded : undefined)
  const subjectiveGradingFailed = 'subjectiveGradingFailed' in status
    ? status.subjectiveGradingFailed
    : ('subjective_grading_failed' in status ? status.subjective_grading_failed : undefined)
  const successMessage = 'message' in status ? status.message : '정상적으로 처리되었습니다.'

  return (
    <div className="space-y-1 rounded-[18px] bg-emerald-50 px-4 py-3 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <CheckCircle2 className="h-4 w-4" />
        <span>완료</span>
      </div>
      <p className="text-xs">{successMessage}</p>
      {questionsParsed != null && (
        <p className="text-xs">
          {questionsParsed}문항 저장
          {studentsRegraded ? ` · ${studentsRegraded}명 재채점` : ''}
        </p>
      )}
      {'generatedCount' in status && status.generatedCount != null && (
        <p className="text-xs">{status.generatedCount}문항에 AI 해설을 채웠습니다.</p>
      )}
      {subjectiveGradingFailed && (
        <p className="text-xs text-amber-700 dark:text-amber-300">서술형 AI 채점은 실패했지만 문항 데이터는 저장되었습니다.</p>
      )}
    </div>
  )
}

export function AnswerSheetUploader({ weekId, savedFilePath, readingTotal = 0 }: Props) {
  const answerInputRef = useRef<HTMLInputElement>(null)
  const problemInputRef = useRef<HTMLInputElement>(null)
  const answerKeyInputRef = useRef<HTMLInputElement>(null)
  const [answerFile, setAnswerFile] = useState<File | null>(null)
  const [problemFiles, setProblemFiles] = useState<UploadAsset[]>([])
  const [answerKeyFiles, setAnswerKeyFiles] = useState<UploadAsset[]>([])
  const [parseMode, setParseMode] = useState<AnswerParseMode>('auto')
  const [showLegacyAnswerUpload, setShowLegacyAnswerUpload] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [problemStatus, setProblemStatus] = useState<LocalStatus>({ type: 'idle' })
  const [answerKeyStatus, setAnswerKeyStatus] = useState<LocalStatus>({ type: 'idle' })
  const [regradeAfterAnswerKey, setRegradeAfterAnswerKey] = useState(false)
  const [problemImported, setProblemImported] = useState(readingTotal > 0)
  const [warningOpen, setWarningOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingUploadAction>(null)
  const [warningCount, setWarningCount] = useState(0)
  const qc = useQueryClient()

  const status = useUploadStore((state) => state.answerSheet[weekId]) ?? IDLE_STATUS
  const setStatus = useUploadStore((state) => state.setAnswerSheet)
  const answerStepReady = problemImported
  const activeWorkflowStep = answerStepReady ? 2 : 1

  useEffect(() => {
    setProblemImported(readingTotal > 0)
  }, [readingTotal])

  useEffect(() => {
    const isLoading = status.type === 'loading' || problemStatus.type === 'loading' || answerKeyStatus.type === 'loading'
    if (!isLoading) return
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [answerKeyStatus.type, problemStatus.type, status.type])

  // 청크 분리 가져오기는 브라우저가 오케스트레이터라 탭이 닫히면 다음 요청이 안 나간다 — 닫기 전 경고
  useEffect(() => {
    const isLoading = status.type === 'loading' || problemStatus.type === 'loading' || answerKeyStatus.type === 'loading'
    if (!isLoading) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [answerKeyStatus.type, problemStatus.type, status.type])

  function resetQueries() {
    qc.invalidateQueries({ queryKey: ['exam-questions', weekId] })
    qc.invalidateQueries({ queryKey: ['grade', weekId] })
    qc.invalidateQueries({ queryKey: ['week', weekId] })
  }

  function handleAnswerFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0]
    if (!nextFile) return
    setAnswerFile(nextFile)
    setStatus(weekId, { type: 'idle' })
  }

  function handleProblemFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = buildUploadAssets(event.target.files)
    if (!nextFiles.length) return
    setProblemFiles(nextFiles)
    setProblemStatus({ type: 'idle' })
  }

  function handleAnswerKeyFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = buildUploadAssets(event.target.files)
    if (!nextFiles.length) return
    setAnswerKeyFiles(nextFiles)
    setAnswerKeyStatus({ type: 'idle' })
  }

  function moveProblemFile(index: number, direction: -1 | 1) {
    setProblemFiles((prev) => moveUploadAsset(prev, index, direction))
  }

  function moveAnswerKeyFile(index: number, direction: -1 | 1) {
    setAnswerKeyFiles((prev) => moveUploadAsset(prev, index, direction))
  }

  function removeProblemFile(index: number) {
    setProblemFiles((prev) => prev.filter((_, fileIndex) => fileIndex !== index))
  }

  function removeAnswerKeyFile(index: number) {
    setAnswerKeyFiles((prev) => prev.filter((_, fileIndex) => fileIndex !== index))
  }

  function resetProblemImportSelection() {
    setProblemFiles([])
    setProblemStatus({ type: 'idle' })
    if (problemInputRef.current) problemInputRef.current.value = ''
  }

  function resetAnswerKeySelection() {
    setAnswerKeyFiles([])
    setAnswerKeyStatus({ type: 'idle' })
    if (answerKeyInputRef.current) answerKeyInputRef.current.value = ''
  }

  async function hasExistingStudentAnswers() {
    const response = await fetch(`/api/weeks/${weekId}/answer-sheet-impact`, { cache: 'no-store' })
    const raw = await response.text()
    const data = parseJsonSafely(raw)

    if (!response.ok) {
      throw new Error(String(data.error ?? '학생 답안 상태를 확인하지 못했습니다.'))
    }

    return {
      hasStudentAnswers: Boolean(data.has_student_answers),
      answerCount: Number(data.answer_count ?? 0),
    }
  }

  async function guardBeforeUpload(action: Exclude<PendingUploadAction, null>) {
    const { hasStudentAnswers, answerCount } = await hasExistingStudentAnswers()
    if (!hasStudentAnswers) return true

    setWarningCount(answerCount)
    setPendingAction(action)
    setWarningOpen(true)
    return false
  }

  // ...Confirmed 를 먼저 선언한다 — 호출부가 아래 함수를 호이스팅으로 참조하면
  // React Compiler 가 이 컴포넌트를 최적화에서 제외한다(PruneHoistedContexts).
  async function handleStandardUploadConfirmed() {
    if (!answerFile) return

    setElapsed(0)
    setStatus(weekId, { type: 'loading', step: '해설지를 읽는 중입니다.' })

    await runOrReport(async () => {
      const base64 = await readFileAsBase64(answerFile)
      const response = await fetch(`/api/weeks/${weekId}/parse-answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileData: base64,
          mimeType: answerFile.type,
          fileName: answerFile.name,
          parseMode,
        }),
      })

      const raw = await response.text()
      const data = parseJsonSafely(raw)

      if (!response.ok) {
        setStatus(weekId, { type: 'error', message: String(data.error ?? '처리에 실패했습니다.') })
        return
      }

      const questionsParsed = Number(data.questions_parsed ?? 0)
      const studentsRegraded = Number(data.students_regraded ?? 0)

      setStatus(weekId, {
        type: 'done',
        questions_parsed: questionsParsed,
        students_regraded: studentsRegraded,
        subjective_grading_failed: Boolean(data.subjective_grading_failed),
      })

      resetQueries()
      toast.success(`${questionsParsed}문항을 반영했습니다.`)
    }, (error) => setStatus(weekId, { type: 'error', message: errorMessage(error, '오류가 발생했습니다.') }))
  }

  async function handleStandardUpload() {
    if (!await guardBeforeUpload('standard')) return
    await handleStandardUploadConfirmed()
  }

  async function handleProblemImportConfirmed(): Promise<boolean> {
    if (!problemFiles.length) return false
    let succeeded = false

    setElapsed(0)
    setProblemStatus({ type: 'loading', message: '시험지 파일에서 문항 구조를 정리하고 있습니다.' })

    await runOrReport(async () => {
      const [file] = await uploadFilesToTempStorage(problemFiles, weekId, 'problem-sheet')

      // 청크 분리 가져오기: 계획 → 청크별 파싱(요청 분리, Vercel 300초 제한 회피) → finalize
      const planResponse = await fetch(`/api/weeks/${weekId}/import-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath: file.storagePath, mimeType: file.mimeType }),
      })
      const planData = parseJsonSafely(await planResponse.text())
      if (!planResponse.ok) {
        setProblemStatus({ type: 'error', message: String(planData.error ?? '청크 계획 수립에 실패했습니다.') })
        return
      }

      const chunks = (planData.chunks ?? []) as { startPage: number; endPage: number }[]
      if (!chunks.length) {
        setProblemStatus({ type: 'error', message: '시험지 페이지를 읽지 못했습니다.' })
        return
      }

      let processed = 0
      setProblemStatus({ type: 'loading', message: '문항 구조를 파싱하고 있습니다.', processedCount: 0, totalCount: chunks.length })

      const parseChunk = async (chunk: { startPage: number; endPage: number }, index: number) => {
        const response = await fetch(`/api/weeks/${weekId}/import-chunk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storagePath: file.storagePath,
            mimeType: file.mimeType,
            chunkIndex: index,
            startPage: chunk.startPage,
            endPage: chunk.endPage,
          }),
        })
        if (!response.ok) {
          const data = parseJsonSafely(await response.text())
          throw new Error(String(data.error ?? `청크 ${index + 1} 파싱에 실패했습니다.`))
        }
      }

      // 재시도까지 실패한 청크는 모아서 계속 진행 — 성공한 청크까지 버리지 않는다 (부분 저장 + 결손 보고)
      const failedChunks: { index: number; startPage: number; endPage: number }[] = []
      await mapWithConcurrency(chunks, CHUNK_REQUEST_CONCURRENCY, async (chunk, index) => {
        try {
          await parseChunk(chunk, index)
        } catch {
          try {
            await parseChunk(chunk, index) // 네트워크 순단 대비 1회 자동 재시도 (멱등)
          } catch {
            failedChunks.push({ index, startPage: chunk.startPage + 1, endPage: chunk.endPage })
          }
        }
        processed += 1
        setProblemStatus({ type: 'loading', message: '문항 구조를 파싱하고 있습니다.', processedCount: processed, totalCount: chunks.length })
      })

      if (failedChunks.length === chunks.length) {
        setProblemStatus({ type: 'error', message: '모든 구간 파싱에 실패했습니다. 잠시 후 다시 시도해주세요.' })
        return
      }

      setProblemStatus({ type: 'loading', message: '파싱 결과를 합쳐 저장하고 있습니다.', processedCount: chunks.length, totalCount: chunks.length })
      const response = await fetch(`/api/weeks/${weekId}/import-finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storagePath: file.storagePath,
          mimeType: file.mimeType,
          fileName: file.fileName,
          chunkCount: chunks.length,
          failedChunkIndexes: failedChunks.map((chunk) => chunk.index),
        }),
      })

      const raw = await response.text()
      const data = parseJsonSafely(raw)

      if (!response.ok) {
        setProblemStatus({ type: 'error', message: String(data.error ?? '문제지형 가져오기에 실패했습니다.') })
        return
      }

      const questionsParsed = Number(data.questions_parsed ?? 0)
      const studentsRegraded = Number(data.students_regraded ?? 0)
      const sourceImagesSaved = Number(data.source_images_saved ?? 0)

      // 결손 보고: 서버가 집계한 skip 페이지 + 재시도까지 실패한 청크의 페이지 범위
      const skippedPages = (Array.isArray(data.skipped_pages) ? data.skipped_pages as number[] : [])
      const failedRanges = failedChunks.map((chunk) => chunk.startPage === chunk.endPage
        ? `${chunk.startPage}쪽`
        : `${chunk.startPage}~${chunk.endPage}쪽`)
      const gapNotice = [...skippedPages.map((page) => `${page}쪽`), ...failedRanges].join(', ')

      setProblemStatus({
        type: 'done',
        message: gapNotice
          ? `시험지 문항 저장이 완료되었습니다. 단, ${gapNotice}은 인식하지 못했습니다 — 해당 부분만 다시 올리거나 문항을 직접 추가해주세요.`
          : '시험지 문항 저장이 완료되었습니다. 다음 단계에서 정오표를 올려 정답만 반영하세요.',
        questionsParsed,
        studentsRegraded,
        subjectiveGradingFailed: Boolean(data.subjective_grading_failed),
      })
      setProblemImported(true)
      succeeded = true
      resetQueries()
      if (sourceImagesSaved > 0) toast.success(`원본 이미지 ${sourceImagesSaved}개를 저장했습니다.`)
      if (gapNotice) toast.warning(`${gapNotice}은 건너뛰었습니다. 나머지 ${questionsParsed}문항만 저장됨`)
      else toast.success(`${questionsParsed}문항을 시험지 PDF에서 저장했습니다. 이제 정오표를 올려주세요.`)
    }, (error) => setProblemStatus({ type: 'error', message: errorMessage(error, '오류가 발생했습니다.') }))
    return succeeded
  }

  async function handleProblemImport() {
    if (!await guardBeforeUpload('problem')) return
    await handleProblemImportConfirmed()
  }

  async function handleAnswerKeyImport() {
    if (!answerKeyFiles.length) return
    if (!problemImported) {
      setAnswerKeyStatus({ type: 'error', message: '먼저 시험지 문항 저장을 완료해주세요.' })
      return
    }
    await handleAnswerKeyImportConfirmed()
  }

  async function handleOneClickImport() {
    if (!problemFiles.length || !answerKeyFiles.length) return
    if (!await guardBeforeUpload('problem')) return
    const problemOk = await handleProblemImportConfirmed()
    if (!problemOk) return
    await handleAnswerKeyImportConfirmed()
  }

  async function handleAnswerKeyImportConfirmed() {
    if (!answerKeyFiles.length) return

    setElapsed(0)
    setAnswerKeyStatus({ type: 'loading', message: '정오표에서 문항별 정답을 읽어 기존 문항에 반영하고 있습니다.' })

    await runOrReport(async () => {
      const [file] = await uploadFilesToTempStorage(answerKeyFiles, weekId, 'answer-key')

      // 청크 분리: 계획 → 청크별 파싱 → finalize(정답 반영+선택 재채점) → 해설 드레인
      const planResponse = await fetch(`/api/weeks/${weekId}/import-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath: file.storagePath, mimeType: file.mimeType, mode: 'answer_key' }),
      })
      const planData = parseJsonSafely(await planResponse.text())
      if (!planResponse.ok) {
        setAnswerKeyStatus({ type: 'error', message: String(planData.error ?? '정오표 청크 계획 수립에 실패했습니다.') })
        return
      }
      const chunks = (planData.chunks ?? []) as { startPage: number; endPage: number }[]
      if (!chunks.length) {
        setAnswerKeyStatus({ type: 'error', message: '정오표 페이지를 읽지 못했습니다.' })
        return
      }

      let processed = 0
      setAnswerKeyStatus({ type: 'loading', message: '정오표를 읽고 있습니다.', processedCount: 0, totalCount: chunks.length })

      const parseChunk = async (chunk: { startPage: number; endPage: number }, index: number) => {
        const response = await fetch(`/api/weeks/${weekId}/answer-key-chunk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storagePath: file.storagePath,
            mimeType: file.mimeType,
            chunkIndex: index,
            startPage: chunk.startPage,
            endPage: chunk.endPage,
          }),
        })
        if (!response.ok) {
          const data = parseJsonSafely(await response.text())
          throw new Error(String(data.error ?? `정오표 청크 ${index + 1} 파싱에 실패했습니다.`))
        }
      }

      await mapWithConcurrency(chunks, CHUNK_REQUEST_CONCURRENCY, async (chunk, index) => {
        try {
          await parseChunk(chunk, index)
        } catch {
          await parseChunk(chunk, index) // 네트워크 순단 대비 1회 자동 재시도 (멱등)
        }
        processed += 1
        setAnswerKeyStatus({ type: 'loading', message: '정오표를 읽고 있습니다.', processedCount: processed, totalCount: chunks.length })
      })

      setAnswerKeyStatus({ type: 'loading', message: '정답을 반영하고 있습니다.', processedCount: chunks.length, totalCount: chunks.length })
      const response = await fetch(`/api/weeks/${weekId}/answer-key-finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storagePath: file.storagePath,
          chunkCount: chunks.length,
          regradeExistingAnswers: regradeAfterAnswerKey,
        }),
      })

      const raw = await response.text()
      const data = parseJsonSafely(raw)

      if (!response.ok) {
        setAnswerKeyStatus({ type: 'error', message: String(data.error ?? '정오표 가져오기에 실패했습니다.') })
        return
      }

      const questionsParsed = Number(data.questions_parsed ?? 0)
      const studentsRegraded = Number(data.students_regraded ?? 0)
      resetQueries()
      toast.success(`${questionsParsed}문항에 정오표 정답을 반영했습니다.`)

      // 해설 드레인: 요청당 일부 배치만 생성 → remaining 0 까지 반복 (실패는 삼키고 종료)
      let generatedTotal = 0
      let drainFailed = false
      try {
        for (let guard = 0; guard < 20; guard += 1) {
          setAnswerKeyStatus({
            type: 'loading',
            message: generatedTotal > 0
              ? `AI 해설을 생성하고 있습니다. (${generatedTotal}문항 완료)`
              : 'AI 해설을 생성하고 있습니다.',
          })
          const drainResponse = await fetch(`/api/weeks/${weekId}/explanations-drain`, { method: 'POST' })
          if (!drainResponse.ok) { drainFailed = true; break }
          const drain = parseJsonSafely(await drainResponse.text())
          generatedTotal += Number(drain.generated ?? 0)
          if (Number(drain.failed_batches ?? 0) > 0) drainFailed = true
          if (Number(drain.remaining ?? 0) <= 0) break
        }
      } catch {
        drainFailed = true // 해설은 부가 정보 — 정답 반영 결과를 막지 않는다
      }

      setAnswerKeyStatus({
        type: 'done',
        message: drainFailed
          ? '정오표 정답 반영이 완료되었습니다. (일부 해설 생성 실패 — 정오표를 다시 올리면 남은 해설만 이어서 생성됩니다)'
          : '정오표 정답 반영과 해설 생성이 완료되었습니다.',
        questionsParsed,
        studentsRegraded,
        generatedCount: generatedTotal,
        subjectiveGradingFailed: Boolean(data.subjective_grading_failed),
      })
      resetQueries()
    }, (error) => setAnswerKeyStatus({ type: 'error', message: errorMessage(error, '오류가 발생했습니다.') }))
  }



  async function openSavedFile() {
    if (!savedFilePath) return
    const response = await fetch(`/api/answer-sheet-url?path=${encodeURIComponent(savedFilePath)}`)
    if (!response.ok) {
      toast.error('저장된 파일 링크를 불러오지 못했습니다.')
      return
    }
    const { url } = await response.json()
    window.open(url, '_blank')
  }

  async function continueWarningAction() {
    setWarningOpen(false)
    const action = pendingAction
    setPendingAction(null)

    if (action === 'standard') {
      await handleStandardUploadConfirmed()
      return
    }

    if (action === 'problem') {
      await handleProblemImportConfirmed()
    }
  }

  return (
    <>
      <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
        문항이 많은 PDF는 시험지 가져오기에서 문항, 정답, 해설을 필요한 단계만 나눠 처리하는 흐름이 더 안정적입니다.
      </p>

      {savedFilePath && status.type !== 'done' && (
        <button
          type="button"
          onClick={openSavedFile}
          className="flex w-full items-center gap-2 rounded-[20px] bg-blue-50/80 px-4 py-3 text-left text-xs text-blue-700 transition hover:bg-blue-100/80 dark:bg-slate-900/70 dark:text-slate-200"
        >
          <FileCheck className="h-4 w-4 shrink-0" />
          <span>
            저장된 PDF가 있습니다.
            <span className="ml-1 font-mono opacity-70">{savedFilePath.split('/').pop()}</span>
          </span>
        </button>
      )}

      {showLegacyAnswerUpload ? (
      <Card className="rounded-[24px] border-0 bg-white/95 shadow-[0_10px_40px_rgba(0,75,198,0.03)] dark:border dark:border-white/5 dark:bg-slate-900/90">
        <CardHeader className="gap-1">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-base text-slate-900 dark:text-slate-50">일반 해설지 업로드</CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => setShowLegacyAnswerUpload(false)}
              aria-label="일반 해설지 업로드 닫기"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
          </div>
          <CardDescription className="text-slate-500 dark:text-slate-400">
            해설이 포함된 PDF나 정리된 정답지를 빠르게 반영합니다. 기존 정상 파일은 이 흐름을 그대로 사용하면 됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">해설지 형식</p>
            <Select value={parseMode} onValueChange={(value) => setParseMode(value as AnswerParseMode)}>
              <SelectTrigger className="h-10 rounded-xl border-0 bg-slate-50 dark:bg-slate-900/70">
                <SelectValue placeholder="형식을 선택하세요." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">자동 판별</SelectItem>
                <SelectItem value="answer_sheet">해설 포함</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              자동 판별이 기본값입니다. 문제지형 PDF는 아래 전용 가져오기로 분리하는 편이 더 안정적입니다.
            </p>
          </div>

          {status.type === 'loading' ? (
            <AnswerParseProgress elapsed={elapsed} />
          ) : (
            <FileDropzone
              file={answerFile}
              inputRef={answerInputRef}
              onChange={handleAnswerFile}
              accept="application/pdf,image/*"
              idleLabel="클릭해서 해설지 파일을 선택하세요. (PDF / 이미지)"
            />
          )}

          <StatusBanner status={status} />

          {answerFile && status.type !== 'done' && status.type !== 'loading' && (
            <Button className="w-full rounded-full bg-blue-600 text-white hover:bg-blue-700" onClick={handleStandardUpload}>
              <Upload className="h-4 w-4" />
              {savedFilePath ? '해설지 다시 등록' : '해설지 등록'}
            </Button>
          )}

          {status.type === 'done' && (
            <Button
              variant="outline"
              className="w-full rounded-full"
              onClick={() => {
                setAnswerFile(null)
                setParseMode('auto')
                setStatus(weekId, { type: 'idle' })
                if (answerInputRef.current) answerInputRef.current.value = ''
              }}
            >
              다른 해설지 업로드
            </Button>
          )}
        </CardContent>
      </Card>
      ) : (
        <button
          type="button"
          onClick={() => setShowLegacyAnswerUpload(true)}
          className="flex w-full items-center justify-between rounded-[20px] bg-white/80 px-4 py-3 text-left text-xs text-slate-500 shadow-[0_10px_30px_rgba(0,75,198,0.03)] transition hover:bg-white dark:bg-slate-900/70 dark:text-slate-300"
        >
          <span>일반 해설지 업로드 열기</span>
          <ChevronDown className="h-4 w-4" />
        </button>
      )}

      <Card className="rounded-[24px] border-0 bg-white/95 shadow-[0_10px_40px_rgba(0,75,198,0.03)] dark:border dark:border-white/5 dark:bg-slate-900/90">
        <CardHeader className="gap-1">
          <CardTitle className="text-base text-slate-900 dark:text-slate-50">시험지 가져오기</CardTitle>
          <CardDescription className="text-slate-500 dark:text-slate-400">
            문제, 정답, 해설을 한 번에 처리하지 않고 단계별로 나눠 안정적으로 반영합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-[20px] bg-blue-50/80 p-4 text-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <ListOrdered className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>진행 순서</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { n: 1, title: '문항 저장', desc: '시험지 PDF에서 번호, 지문, 발문, 선택지를 저장' },
                { n: 2, title: '정답 반영', desc: '정오표나 답안표에서 정답만 덮어쓰기' },
              ].map((step) => {
                const done = step.n < activeWorkflowStep
                const active = step.n === activeWorkflowStep
                return (
                  <div
                    key={step.n}
                    className={`rounded-[16px] px-3 py-3 text-xs leading-5 ${
                      active
                        ? 'bg-white text-slate-800 shadow-[0_10px_30px_rgba(0,75,198,0.05)] dark:bg-slate-950/50 dark:text-slate-100'
                        : done
                          ? 'bg-white/70 text-slate-500 dark:bg-slate-950/30 dark:text-slate-400'
                          : 'bg-blue-100/50 text-slate-400 dark:bg-slate-950/20 dark:text-slate-500'
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2 font-semibold">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                        done ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                      }`}>
                        {done ? '완' : step.n}
                      </span>
                      <span>{step.title}</span>
                    </div>
                    <p>{step.desc}</p>
                  </div>
                )
              })}
            </div>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              기본 흐름은 시험지 PDF 업로드 → 정오표 업로드입니다. 정답이 반영되면 비어 있는 해설은 AI 가 자동으로 채웁니다.
            </p>
          </div>

          <div className="space-y-3 rounded-[20px] bg-white/80 p-4 shadow-[0_10px_30px_rgba(0,75,198,0.04)] dark:bg-slate-950/40">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">1. 시험지 PDF 업로드</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                문제 본문이 들어 있는 시험지 PDF를 읽어 문항 구조와 문제 텍스트를 먼저 저장합니다.
              </p>
            </div>

            {problemStatus.type === 'loading' ? (
              <AnswerParseProgress
                elapsed={elapsed}
                processedCount={problemStatus.processedCount}
                totalCount={problemStatus.totalCount}
                message={problemStatus.message}
              />
            ) : (
              <FileDropzone
                file={problemFiles[0]?.file ?? null}
                inputRef={problemInputRef}
                onChange={handleProblemFile}
                accept="application/pdf,image/*"
                idleLabel="클릭해서 시험지 PDF 1개 또는 페이지 순서대로 이미지 여러 장을 선택하세요."
                multiple
              />
            )}

            {problemFiles.length > 0 && (
              <OrderedFileList
                files={problemFiles}
                onMove={moveProblemFile}
                onRemove={removeProblemFile}
              />
            )}

            <StatusBanner status={problemStatus} />

            {problemFiles.length > 0 && problemStatus.type !== 'loading' && problemStatus.type !== 'done' && (
              answerKeyFiles.length > 0 && answerKeyStatus.type !== 'loading' ? (
                <Button className="w-full rounded-full bg-slate-900 text-white hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700" onClick={handleOneClickImport}>
                  <Upload className="h-4 w-4" />
                  문항 저장 + 정답 반영 + 해설 생성 한 번에
                </Button>
              ) : (
                <Button className="w-full rounded-full bg-slate-900 text-white hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700" onClick={handleProblemImport}>
                  <Upload className="h-4 w-4" />
                  시험지에서 문항 저장
                </Button>
              )
            )}

            {problemStatus.type === 'done' && (
              <Button variant="outline" className="w-full rounded-full" onClick={resetProblemImportSelection}>
                다른 시험지 선택
              </Button>
            )}
          </div>

          <div className={`space-y-3 rounded-[20px] p-4 shadow-[0_10px_30px_rgba(0,75,198,0.04)] ${
            problemImported
              ? 'bg-white/80 dark:bg-slate-950/40'
              : 'bg-slate-50/80 opacity-70 dark:bg-slate-950/30'
          }`}>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">2. 정오표 업로드</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {problemImported
                  ? '시험지 저장 후 정오표 이미지를 올리면 기존 문항에 정답만 덮어쓰고 학생 점수도 다시 계산합니다.'
                  : '정오표를 미리 올려두면 1단계 버튼이 "한 번에 가져오기"로 바뀝니다. 시험지 저장 후 따로 반영할 수도 있습니다.'}
              </p>
            </div>

            {answerKeyStatus.type === 'loading' ? (
              <AnswerParseProgress
                elapsed={elapsed}
                processedCount={answerKeyStatus.processedCount}
                totalCount={answerKeyStatus.totalCount}
                message={answerKeyStatus.message}
              />
            ) : (
              <FileDropzone
                file={answerKeyFiles[0]?.file ?? null}
                inputRef={answerKeyInputRef}
                onChange={handleAnswerKeyFile}
                accept="application/pdf,image/*"
                idleLabel="클릭해서 정오표 PDF 1개 또는 페이지 순서대로 이미지 여러 장을 선택하세요."
                multiple
              />
            )}

            {answerKeyFiles.length > 0 && (
              <OrderedFileList
                files={answerKeyFiles}
                onMove={moveAnswerKeyFile}
                onRemove={removeAnswerKeyFile}
              />
            )}

            {problemImported && <StatusBanner status={answerKeyStatus} />}

            {answerKeyFiles.length > 0 && answerKeyStatus.type !== 'loading' && answerKeyStatus.type !== 'done' && (
              <label className="flex items-start gap-3 rounded-[18px] bg-slate-50/90 px-4 py-3 text-xs leading-5 text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
                <Checkbox
                  checked={regradeAfterAnswerKey}
                  onCheckedChange={(checked) => setRegradeAfterAnswerKey(checked === true)}
                  className="mt-0.5"
                />
                <span>
                  정답 반영 후 기존 학생 답안을 바로 재채점합니다. 문항이나 학생 답안이 많으면 시간이 오래 걸릴 수 있습니다.
                </span>
              </label>
            )}

            {problemImported && answerKeyFiles.length > 0 && answerKeyStatus.type !== 'loading' && answerKeyStatus.type !== 'done' && (
              <Button
                variant="outline"
                className="w-full rounded-full border-0 bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
                onClick={handleAnswerKeyImport}
              >
                <Upload className="h-4 w-4" />
                정오표 정답 반영
              </Button>
            )}

            {answerKeyStatus.type === 'done' && (
              <Button variant="outline" className="w-full rounded-full" onClick={resetAnswerKeySelection}>
                다른 정오표 선택
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      </div>
      <Dialog
        open={warningOpen}
        onOpenChange={(open) => {
          setWarningOpen(open)
          if (!open) setPendingAction(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>학생 답안이 있는 상태입니다</DialogTitle>
            <DialogDescription>
              이미 입력된 학생 답안이 {warningCount}개 있습니다. 재업로드하면 문항과 정답이 새 파일 기준으로 바뀌고,
              사라진 문항의 학생 답안은 함께 삭제될 수 있습니다. 계속 진행할까요?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setWarningOpen(false)
                setPendingAction(null)
              }}
            >
              취소
            </Button>
            <Button className="bg-red-500 text-white hover:bg-red-600" onClick={continueWarningAction}>
              그래도 재업로드
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
