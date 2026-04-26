'use client'

import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck,
  FileText,
  ListOrdered,
  Sparkles,
  Upload,
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
}) {
  const { file, inputRef, onChange, accept, idleLabel } = props

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
        className="hidden"
        onChange={onChange}
      />
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
  const [answerFile, setAnswerFile] = useState<File | null>(null)
  const [problemFile, setProblemFile] = useState<File | null>(null)
  const [parseMode, setParseMode] = useState<AnswerParseMode>('auto')
  const [elapsed, setElapsed] = useState(0)
  const [problemStatus, setProblemStatus] = useState<LocalStatus>({ type: 'idle' })
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
    const isLoading = status.type === 'loading' || problemStatus.type === 'loading'
    if (!isLoading) return
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [problemStatus.type, status.type])

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
    const nextFile = event.target.files?.[0]
    if (!nextFile) return
    setProblemFile(nextFile)
    setProblemStatus({ type: 'idle' })
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
    if (!problemFile) return

    setElapsed(0)
    setProblemStatus({ type: 'loading', message: '문제지 PDF에서 문항과 정답을 구조화하고 있습니다.' })

    try {
      const base64 = await readFileAsBase64(problemFile)
      const response = await fetch(`/api/weeks/${weekId}/import-problem-sheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileData: base64,
          mimeType: problemFile.type,
          fileName: problemFile.name,
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
        message: '문항 구조와 정답 저장이 완료되었습니다.',
        questionsParsed,
        studentsRegraded,
        subjectiveGradingFailed: Boolean(data.subjective_grading_failed),
      })
      setCanGenerateExplanations(questionsParsed > 0)
      resetQueries()
      toast.success(`${questionsParsed}문항을 중간·기말 전용 경로로 가져왔습니다.`)
    } catch (error) {
      setProblemStatus({ type: 'error', message: error instanceof Error ? error.message : '오류가 발생했습니다.' })
    }
  }

  async function handleGenerateExplanations() {
    setExplanationStatus({ type: 'loading', message: '저장된 문항을 기준으로 AI 해설을 생성하고 있습니다.' })

    try {
      const response = await fetch(`/api/weeks/${weekId}/generate-reading-explanations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      })

      const raw = await response.text()
      const data = parseJsonSafely(raw)

      if (!response.ok) {
        setExplanationStatus({ type: 'error', message: String(data.error ?? 'AI 해설 생성에 실패했습니다.') })
        return
      }

      const generatedCount = Number(data.generated_count ?? 0)
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
        일반 주차 해설지는 기존 업로드로 처리하고, 중간·기말처럼 문제지와 정답이 섞인 PDF는 아래 전용 가져오기를 사용하세요.
        특수 PDF는 먼저 문항과 정답만 저장한 뒤, 필요하면 AI 해설을 나중에 붙이는 구조입니다.
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
          <CardTitle className="text-base text-slate-900 dark:text-slate-50">중간·기말 전용 가져오기</CardTitle>
          <CardDescription className="text-slate-500 dark:text-slate-400">
            상단에 문제, 하단에 답안을 따로 모은 PDF를 읽어와 문항, 정답, 채점 세팅까지 먼저 마무리합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-[20px] bg-slate-50/90 px-4 py-3 text-xs leading-5 text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
            이 흐름은 AI 해설을 바로 만들지 않습니다. 먼저 DB 세팅과 재채점을 안정적으로 끝내고, 필요할 때 아래 버튼으로 해설만 따로 생성합니다.
          </div>

          <div className="rounded-[20px] bg-blue-50/80 p-4 text-xs leading-5 text-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <ListOrdered className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>권장 PDF 형식</span>
            </div>
            <p>1. 상단에는 문제만 순서대로 배치하세요.</p>
            <p>2. 하단에는 답안만 따로 모아 한 줄에 한 문항씩 적어주세요.</p>
            <p>3. 가장 안정적인 표기는 `1. ③`, `2. ⑤`, `7. 서답형 정답`처럼 문항 번호를 파일 순서대로 맞추는 방식입니다.</p>
            <p>4. 문제 본문 중간에 정답이나 해설을 끼워 넣는 형식은 피하는 것이 좋습니다.</p>
          </div>

          {problemStatus.type === 'loading' ? (
            <AnswerParseProgress elapsed={elapsed} />
          ) : (
            <FileDropzone
              file={problemFile}
              inputRef={problemInputRef}
              onChange={handleProblemFile}
              accept="application/pdf"
              idleLabel="클릭해서 중간·기말 PDF를 선택하세요. 문제는 위, 답안은 아래에 모인 형식이 가장 좋습니다."
            />
          )}

          <StatusBanner status={problemStatus} />

          {problemFile && problemStatus.type !== 'loading' && (
            <Button className="w-full rounded-full bg-slate-900 text-white hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700" onClick={handleProblemImport}>
              <Upload className="h-4 w-4" />
              문항/정답 먼저 가져오기
            </Button>
          )}

          {(canGenerateExplanations || problemStatus.type === 'done') && (
            <div className="space-y-3 rounded-[20px] bg-blue-50/70 p-4 dark:bg-slate-900/60">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI 해설 후처리</p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  저장된 문항을 기준으로 비어 있는 해설만 채웁니다. 실패해도 문항과 정답 세팅은 유지됩니다.
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
