'use client'

import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import { errorMessage, runOrReport } from '@/lib/async-ui'
import { AlertTriangle, CheckCircle2, FileCheck, FileText, Upload } from 'lucide-react'
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
import { useUploadStore, type AnswerSheetStatus } from '@/store/upload-store'

const IDLE_STATUS: AnswerSheetStatus = { type: 'idle' }

const ANSWER_STEPS = [
  { label: '문서를 읽는 중입니다.', sub: '문서 구조와 문항 번호를 확인하고 있습니다.' },
  { label: '문항을 추출하고 있습니다.', sub: '번호 구간별로 병렬로 문항·정답·해설을 구조화하고 있습니다.' },
  { label: '기존 채점 결과를 갱신하고 있습니다.', sub: '저장된 학생 답안을 새 정답 기준으로 다시 계산하고 있습니다.' },
]

type PendingUploadAction = 'start' | null

interface Props {
  weekId: string
  savedFilePath?: string | null
  readingTotal?: number
}

function safeStorageName(fileName: string) {
  return fileName
    .replace(/[^\x00-\x7F]/g, '_')
    .replace(/[/\\?%*:|"<>\s]/g, '_')
    .replace(/_+/g, '_')
}

/** PDF 를 임시 스토리지에 올리고 storagePath 를 받는다 (4.5MB body 한도 회피) */
async function uploadToTempStorage(file: File, weekId: string) {
  const presignResponse = await fetch(`/api/weeks/${weekId}/import-upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: safeStorageName(file.name) }),
  })

  if (!presignResponse.ok) {
    const data = await presignResponse.json().catch(() => ({ error: '업로드 URL 발급에 실패했습니다.' }))
    throw new Error(String(data.error ?? '업로드 URL 발급에 실패했습니다.'))
  }

  const { uploadUrl, path } = await presignResponse.json() as { uploadUrl: string; path: string }
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: file,
  })

  if (!uploadResponse.ok) {
    throw new Error('파일 업로드에 실패했습니다.')
  }

  return { storagePath: path, mimeType: 'application/pdf', fileName: file.name }
}

function parseJsonSafely(raw: string): Record<string, unknown> {
  try {
    return raw ? JSON.parse(raw) as Record<string, unknown> : {}
  } catch {
    return { error: raw || '서버가 JSON이 아닌 응답을 반환했습니다.' }
  }
}

function AnswerParseProgress({ elapsed, message }: { elapsed: number; message?: string }) {
  const idx = elapsed < 15 ? 0 : elapsed < 60 ? 1 : 2
  const current = message ? { label: message, sub: ANSWER_STEPS[idx].sub } : ANSWER_STEPS[idx]
  const progress = Math.min((elapsed / 120) * 100, 95)

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
}) {
  const { file, inputRef, onChange } = props

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
          <p className="text-sm text-slate-500 dark:text-slate-400">클릭해서 시험지 PDF 선택</p>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={onChange}
      />
    </div>
  )
}

function StatusBanner({ status }: { status: AnswerSheetStatus }) {
  if (status.type === 'idle') return null

  if (status.type === 'loading') {
    return (
      <div className="rounded-[18px] bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
        {status.step}
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

  const questionsParsed = 'questions_parsed' in status ? status.questions_parsed : undefined
  const studentsRegraded = 'students_regraded' in status ? status.students_regraded : undefined
  const subjectiveGradingFailed = 'subjective_grading_failed' in status ? status.subjective_grading_failed : undefined

  return (
    <div className="space-y-1 rounded-[18px] bg-emerald-50 px-4 py-3 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <CheckCircle2 className="h-4 w-4" />
        <span>완료</span>
      </div>
      <p className="text-xs">정상적으로 처리되었습니다.</p>
      {questionsParsed != null && (
        <p className="text-xs">
          {questionsParsed}문항 저장
          {studentsRegraded ? ` · ${studentsRegraded}명 재채점` : ''}
        </p>
      )}
      {subjectiveGradingFailed && (
        <p className="text-xs text-amber-700 dark:text-amber-300">서술형 AI 채점은 실패했지만 문항 데이터는 저장되었습니다.</p>
      )}
    </div>
  )
}

export function AnswerSheetUploader({ weekId, savedFilePath }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [warningOpen, setWarningOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingUploadAction>(null)
  const [warningCount, setWarningCount] = useState(0)
  const qc = useQueryClient()

  const status = useUploadStore((state) => state.answerSheet[weekId]) ?? IDLE_STATUS
  const setStatus = useUploadStore((state) => state.setAnswerSheet)

  const isLoading = status.type === 'loading'

  useEffect(() => {
    if (!isLoading) return
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [isLoading])

  function resetQueries() {
    qc.invalidateQueries({ queryKey: ['exam-questions', weekId] })
    qc.invalidateQueries({ queryKey: ['grade', weekId] })
    qc.invalidateQueries({ queryKey: ['week', weekId] })
  }

  function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null
    if (!picked) return
    if (picked.type !== 'application/pdf') {
      toast.error('PDF 파일만 업로드할 수 있습니다.')
      return
    }
    setFile(picked)
    setStatus(weekId, { type: 'idle' })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function resetSelection() {
    setFile(null)
    setStatus(weekId, { type: 'idle' })
    if (fileInputRef.current) fileInputRef.current.value = ''
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

  async function startImportConfirmed() {
    if (!file) return

    setElapsed(0)
    setStatus(weekId, { type: 'loading', step: '파일을 올리는 중입니다.' })

    await runOrReport(async () => {
      const uploaded = await uploadToTempStorage(file, weekId)

      setStatus(weekId, { type: 'loading', step: '문서를 읽는 중입니다.' })
      const response = await fetch(`/api/weeks/${weekId}/parse-answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 이 함수는 두 경로 모두 동의 후에만 호출된다 (답안 없음 / 경고 다이얼로그 확인).
        // 서버는 동의 없이는 409 로 막으므로 여기서 명시적으로 넘긴다.
        body: JSON.stringify({ ...uploaded, discardAnswers: true }),
      })

      const raw = await response.text()
      const data = parseJsonSafely(raw)

      if (!response.ok) {
        setStatus(weekId, { type: 'error', message: String(data.error ?? '처리에 실패했습니다.') })
        return
      }

      const questionsParsed = Number(data.questions_parsed ?? 0)
      const studentsRegraded = Number(data.students_regraded ?? 0)
      const skippedQuestions = Array.isArray(data.skipped_questions) ? data.skipped_questions as number[] : []
      resetQueries()
      toast.success(`${questionsParsed}문항을 반영했습니다.`)
      // 경고는 업로드 전에 "삭제될 수 있다" 로만 알렸다. 실제로 지워진 게 있으면 결과도 알린다 —
      // 그래야 강사가 어느 문항을 다시 입력해야 하는지 그 자리에서 안다.
      const answersDeleted = Number(data.answers_deleted ?? 0)
      if (answersDeleted > 0) {
        toast.warning(`새 파일에서 빠진 ${Number(data.questions_deleted ?? 0)}문항의 학생 답안 ${answersDeleted}개가 삭제됐습니다 — 해당 문항은 다시 입력해 주세요.`)
      }
      if (skippedQuestions.length > 0) {
        toast.warning(`${skippedQuestions.join(', ')}번 문항은 인식하지 못했습니다 — 직접 추가하거나 파일을 다시 올려주세요.`)
      }

      // 해설 보완은 파싱 콜에 통합됨 (프롬프트가 원문 해설을 기반으로 보강 작성) — 별도 드레인 없음
      setStatus(weekId, {
        type: 'done',
        questions_parsed: questionsParsed,
        students_regraded: studentsRegraded,
        subjective_grading_failed: Boolean(data.subjective_grading_failed),
      })
      resetQueries()
    }, (error) => setStatus(weekId, { type: 'error', message: errorMessage(error, '오류가 발생했습니다.') }))
  }

  async function handleStart() {
    if (!file) return
    if (!await guardBeforeUpload('start')) return
    await startImportConfirmed()
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
    if (action === 'start') {
      await startImportConfirmed()
    }
  }

  return (
    <>
      <div className="space-y-4">
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
          <CardTitle className="text-base text-slate-900 dark:text-slate-50">시험지 가져오기</CardTitle>
          <CardDescription className="text-slate-500 dark:text-slate-400">
            PDF를 올리면 문항·정답·해설을 자동으로 반영합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <AnswerParseProgress elapsed={elapsed} message={status.type === 'loading' ? status.step : undefined} />
          ) : (
            <FileDropzone file={file} inputRef={fileInputRef} onChange={handleFileSelect} />
          )}

          <StatusBanner status={status} />

          {file && !isLoading && status.type !== 'done' && (
            <Button className="w-full rounded-full bg-slate-900 text-white hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700" onClick={handleStart}>
              <Upload className="h-4 w-4" />
              문항·정답·해설 등록
            </Button>
          )}

          {status.type === 'done' && (
            <Button variant="outline" className="w-full rounded-full" onClick={resetSelection}>
              다른 파일 선택
            </Button>
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
