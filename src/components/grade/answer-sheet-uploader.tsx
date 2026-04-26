'use client'

import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileCheck,
  FileText,
  ListOrdered,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

type LocalStatus =
  | { type: 'idle' }
  | { type: 'loading'; message: string }
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

function AnswerParseProgress({ elapsed }: { elapsed: number }) {
  const idx = elapsed < 10 ? 0 : elapsed < 30 ? 1 : 2
  const current = ANSWER_STEPS[idx]
  const progress = Math.min((elapsed / 90) * 100, 95)

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
  const [elapsed, setElapsed] = useState(0)
  const [problemStatus, setProblemStatus] = useState<LocalStatus>({ type: 'idle' })
  const [answerKeyStatus, setAnswerKeyStatus] = useState<LocalStatus>({ type: 'idle' })
  const [explanationStatus, setExplanationStatus] = useState<LocalStatus>({ type: 'idle' })
  const [canGenerateExplanations, setCanGenerateExplanations] = useState(readingTotal > 0)
  const [warningOpen, setWarningOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingUploadAction>(null)
  const [warningCount, setWarningCount] = useState(0)
  const qc = useQueryClient()

  const status = useUploadStore((state) => state.answerSheet[weekId]) ?? IDLE_STATUS
  const setStatus = useUploadStore((state) => state.setAnswerSheet)

  useEffect(() => {
    setCanGenerateExplanations(readingTotal > 0)
  }, [readingTotal])

  useEffect(() => {
    const isLoading = status.type === 'loading' || problemStatus.type === 'loading' || answerKeyStatus.type === 'loading'
    if (!isLoading) return
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000)
    return () => clearInterval(timer)
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

  async function handleStandardUpload() {
    if (!await guardBeforeUpload('standard')) return
    await handleStandardUploadConfirmed()
  }

  async function handleStandardUploadConfirmed() {
    if (!answerFile) return

    setElapsed(0)
    setStatus(weekId, { type: 'loading', step: '해설지를 읽는 중입니다.' })

    try {
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
      setCanGenerateExplanations(questionsParsed > 0 || readingTotal > 0)
      toast.success(`${questionsParsed}문항을 반영했습니다.`)
    } catch (error) {
      setStatus(weekId, { type: 'error', message: error instanceof Error ? error.message : '오류가 발생했습니다.' })
    }
  }

  async function handleProblemImport() {
    if (!await guardBeforeUpload('problem')) return
    await handleProblemImportConfirmed()
  }

  async function handleProblemImportConfirmed() {
    if (!problemFiles.length) return

    setElapsed(0)
    setProblemStatus({ type: 'loading', message: '시험지 파일에서 문항 구조를 정리하고 있습니다.' })

    try {
      const files = await uploadFilesToTempStorage(problemFiles, weekId, 'problem-sheet')
      const response = await fetch(`/api/weeks/${weekId}/import-problem-sheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files,
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

      setProblemStatus({
        type: 'done',
        message: '시험지 문항 저장이 완료되었습니다. 이제 정오표를 올려 정답을 반영할 수 있습니다.',
        questionsParsed,
        studentsRegraded,
        subjectiveGradingFailed: Boolean(data.subjective_grading_failed),
      })
      setCanGenerateExplanations(false)
      resetQueries()
      toast.success(`${questionsParsed}문항을 시험지 PDF에서 가져왔습니다.`)
    } catch (error) {
      setProblemStatus({ type: 'error', message: error instanceof Error ? error.message : '오류가 발생했습니다.' })
    }
  }

  async function handleAnswerKeyImport() {
    if (!answerKeyFiles.length) return

    setElapsed(0)
    setAnswerKeyStatus({ type: 'loading', message: '정오표에서 문항별 정답을 읽어 기존 문항에 반영하고 있습니다.' })

    try {
      const files = await uploadFilesToTempStorage(answerKeyFiles, weekId, 'answer-key')
      const response = await fetch(`/api/weeks/${weekId}/import-problem-answer-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files,
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

      setAnswerKeyStatus({
        type: 'done',
        message: '정오표 정답 반영이 완료되었습니다.',
        questionsParsed,
        studentsRegraded,
        subjectiveGradingFailed: Boolean(data.subjective_grading_failed),
      })
      setCanGenerateExplanations(questionsParsed > 0 || readingTotal > 0)
      resetQueries()
      toast.success(`${questionsParsed}문항에 정오표 정답을 반영했습니다.`)
    } catch (error) {
      setAnswerKeyStatus({ type: 'error', message: error instanceof Error ? error.message : '오류가 발생했습니다.' })
    }
  }

  async function handleGenerateExplanations() {
    setExplanationStatus({ type: 'loading', message: '저장된 문항을 기준으로 AI 해설을 생성하고 있습니다.' })

    try {
      let remainingIds: string[] | null = null
      let generatedCount = 0
      let processedCount = 0
      let totalTargetCount: number | null = null

      while (true) {
        const response = await fetch(`/api/weeks/${weekId}/generate-reading-explanations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            force: false,
            ...(remainingIds ? { questionIds: remainingIds } : {}),
          }),
        })

        const raw = await response.text()
        const data = parseJsonSafely(raw)

        if (!response.ok) {
          setExplanationStatus({ type: 'error', message: String(data.error ?? 'AI 해설 생성에 실패했습니다.') })
          return
        }

        generatedCount += Number(data.generated_count ?? 0)
        processedCount += Number(data.processed_count ?? 0)
        remainingIds = Array.isArray(data.remaining_ids)
          ? data.remaining_ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
          : []
        const batchTotal = Number(data.total_target_count ?? (processedCount + remainingIds.length))
        if (totalTargetCount == null) {
          totalTargetCount = batchTotal
        }
        const totalForDisplay = totalTargetCount ?? batchTotal

        if (data.done === true) break

        setExplanationStatus({
          type: 'loading',
          message: `AI 해설 생성 중입니다. ${Math.min(processedCount, totalForDisplay)} / ${totalForDisplay} 문항을 처리했습니다.`,
        })
      }

      setExplanationStatus({
        type: 'done',
        message: generatedCount > 0 ? 'AI 해설 생성을 마쳤습니다.' : '생성할 해설이 없어 건너뛰었습니다.',
        generatedCount,
      })
      resetQueries()
      toast.success(generatedCount > 0 ? `${generatedCount}문항 해설을 생성했습니다.` : '추가로 생성할 해설이 없습니다.')
    } catch (error) {
      setExplanationStatus({ type: 'error', message: error instanceof Error ? error.message : '오류가 발생했습니다.' })
    }
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
        진단평가처럼 분량이 적은 해설·정답지는 위 업로드에서 한 번에 처리하고, 중간·기말처럼 문항이 많은 시험지는 아래에서
        시험지 PDF와 정오표를 나눠 올리는 흐름이 더 안정적입니다.
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

      <Card className="rounded-[24px] border-0 bg-white/95 shadow-[0_10px_40px_rgba(0,75,198,0.03)] dark:border dark:border-white/5 dark:bg-slate-900/90">
        <CardHeader className="gap-1">
          <CardTitle className="text-base text-slate-900 dark:text-slate-50">일반 해설지 업로드</CardTitle>
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

      <Card className="rounded-[24px] border-0 bg-white/95 shadow-[0_10px_40px_rgba(0,75,198,0.03)] dark:border dark:border-white/5 dark:bg-slate-900/90">
        <CardHeader className="gap-1">
          <CardTitle className="text-base text-slate-900 dark:text-slate-50">중간·기말 시험지 가져오기</CardTitle>
          <CardDescription className="text-slate-500 dark:text-slate-400">
            시험지 PDF로 문항을 먼저 저장하고, 정오표 이미지나 PDF로 정답을 따로 반영합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-[20px] bg-slate-50/90 px-4 py-3 text-xs leading-5 text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
            실사용 기준으로는 `시험지 PDF 업로드 → 정오표 업로드 → 필요 시 AI 해설 생성` 순서가 가장 안정적입니다.
          </div>

          <div className="rounded-[20px] bg-blue-50/80 p-4 text-xs leading-5 text-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <ListOrdered className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>권장 업로드 순서</span>
            </div>
            <p>1. 먼저 시험지 PDF를 올려 문항과 문제 텍스트를 저장하세요.</p>
            <p>2. 그다음 정오표 이미지나 PDF를 올려 문항별 정답만 반영하세요.</p>
            <p>3. 정오표는 표 캡처, 스캔 PDF, 답안 리스트 모두 가능하지만 문항 번호가 선명할수록 안정적입니다.</p>
            <p>4. 해설은 마지막에 따로 생성하므로, 처음부터 한 파일에 억지로 합칠 필요는 없습니다.</p>
          </div>

          <div className="space-y-3 rounded-[20px] bg-white/80 p-4 shadow-[0_10px_30px_rgba(0,75,198,0.04)] dark:bg-slate-950/40">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">1. 시험지 PDF 업로드</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                문제 본문이 들어 있는 시험지 PDF를 읽어 문항 구조와 문제 텍스트를 먼저 저장합니다.
              </p>
            </div>

            {problemStatus.type === 'loading' ? (
              <AnswerParseProgress elapsed={elapsed} />
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

            {problemFiles.length > 0 && problemStatus.type !== 'loading' && (
              <Button className="w-full rounded-full bg-slate-900 text-white hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700" onClick={handleProblemImport}>
                <Upload className="h-4 w-4" />
                시험지에서 문항 저장
              </Button>
            )}
          </div>

          <div className="space-y-3 rounded-[20px] bg-white/80 p-4 shadow-[0_10px_30px_rgba(0,75,198,0.04)] dark:bg-slate-950/40">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">2. 정오표 업로드</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                시험지 저장 후 정오표 이미지를 올리면 기존 문항에 정답만 덮어쓰고 학생 점수도 다시 계산합니다.
              </p>
            </div>

            {answerKeyStatus.type === 'loading' ? (
              <AnswerParseProgress elapsed={elapsed} />
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

            <StatusBanner status={answerKeyStatus} />

            {answerKeyFiles.length > 0 && answerKeyStatus.type !== 'loading' && (
              <Button
                variant="outline"
                className="w-full rounded-full border-0 bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
                onClick={handleAnswerKeyImport}
              >
                <Upload className="h-4 w-4" />
                정오표 정답 반영
              </Button>
            )}
          </div>

          {(canGenerateExplanations || answerKeyStatus.type === 'done') && (
            <div className="space-y-3 rounded-[20px] bg-blue-50/70 p-4 dark:bg-slate-900/60">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI 해설 후처리</p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  문항과 정답 저장이 끝난 뒤 비어 있는 해설만 채웁니다. 실패해도 문항과 정답 세팅은 유지됩니다.
                </p>
              </div>

              <StatusBanner status={explanationStatus} />

              <Button
                variant="outline"
                className="w-full rounded-full border-0 bg-white text-blue-700 hover:bg-white/90 dark:bg-slate-800 dark:text-blue-300"
                onClick={handleGenerateExplanations}
                disabled={explanationStatus.type === 'loading'}
              >
                <Sparkles className="h-4 w-4" />
                {explanationStatus.type === 'loading' ? 'AI 해설 생성 중' : '저장 후 AI 해설 생성'}
              </Button>
            </div>
          )}
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
