'use client'

import { useRef, useState, useEffect } from 'react'
import { Upload, CheckCircle2, AlertTriangle, FileText, FileCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUploadStore, AnswerSheetStatus } from '@/store/upload-store'

const IDLE_STATUS: AnswerSheetStatus = { type: 'idle' }

const ANSWER_STEPS = [
  { label: 'Claude가 해설지를 읽는 중...', sub: 'PDF 페이지와 정답 표를 파악하고 있습니다' },
  { label: '정답 추출 중...', sub: '문항별 정답을 하나씩 확인하고 있습니다' },
  { label: '거의 다 됐습니다...', sub: '학생 답안과 대조해 재채점 중입니다' },
]

type ParseMode = 'auto' | 'answer_sheet' | 'problem_sheet'

function AnswerParseProgress({ elapsed }: { elapsed: number }) {
  const idx = elapsed < 10 ? 0 : elapsed < 30 ? 1 : 2
  const current = ANSWER_STEPS[idx]
  const progress = Math.min((elapsed / 90) * 100, 95)

  return (
    <div className="rounded-lg border bg-blue-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-blue-900">{current.label}</p>
        <span className="text-xs text-blue-600">{elapsed}초</span>
      </div>
      <p className="text-xs text-blue-600">{current.sub}</p>
      <div className="h-1.5 w-full rounded-full bg-blue-200">
        <div
          className="h-1.5 rounded-full bg-blue-500 transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}

interface Props {
  weekId: string
  savedFilePath?: string | null
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

export function AnswerSheetUploader({ weekId, savedFilePath }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [parseMode, setParseMode] = useState<ParseMode>('auto')
  const [elapsed, setElapsed] = useState(0)
  const qc = useQueryClient()

  const status = useUploadStore((s) => s.answerSheet[weekId]) ?? IDLE_STATUS
  const setStatus = useUploadStore((s) => s.setAnswerSheet)

  useEffect(() => {
    if (status.type !== 'loading') return
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [status.type])

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const nextFile = e.target.files?.[0]
    if (!nextFile) return
    setFile(nextFile)
    setStatus(weekId, { type: 'idle' })
  }

  async function handleUpload() {
    if (!file) return

    setElapsed(0)
    setStatus(weekId, { type: 'loading', step: 'Claude가 해설지를 읽는 중...' })

    try {
      const base64 = await readFileAsBase64(file)
      setStatus(weekId, { type: 'loading', step: '정답 추출 중...' })

      const res = await fetch(`/api/weeks/${weekId}/parse-answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData: base64, mimeType: file.type, fileName: file.name, parseMode }),
      })

      const raw = await res.text()
      const data = parseJsonSafely(raw)

      if (!res.ok) {
        setStatus(weekId, { type: 'error', message: String(data.error ?? '처리 실패') })
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

      qc.invalidateQueries({ queryKey: ['exam-questions', weekId] })
      qc.invalidateQueries({ queryKey: ['grade', weekId] })
      qc.invalidateQueries({ queryKey: ['week', weekId] })

      toast.success(`${questionsParsed}문항 파싱 완료${studentsRegraded > 0 ? `, ${studentsRegraded}명 재채점` : ''}`)
    } catch (e) {
      setStatus(weekId, { type: 'error', message: e instanceof Error ? e.message : '오류 발생' })
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        PDF 또는 이미지 형식의 답안해설지를 업로드하면 Claude가 정답을 추출합니다.
        재업로드 시 기존 학생 답안은 유지되고 정답만 업데이트됩니다.
      </p>

      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-500">파일 형식</p>
        <Select value={parseMode} onValueChange={(value) => setParseMode(value as ParseMode)}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder="형식 선택" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">자동 판별</SelectItem>
            <SelectItem value="answer_sheet">해설 포함</SelectItem>
            <SelectItem value="problem_sheet">문제지만 있음</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-gray-400">
          자동 판별을 기본으로 사용하고, 애매한 PDF면 형식을 직접 지정해 다시 시도할 수 있습니다.
        </p>
      </div>

      {savedFilePath && status.type !== 'done' && (
        <div
          className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 cursor-pointer hover:bg-blue-100 transition-colors"
          onClick={async () => {
            const res = await fetch(`/api/answer-sheet-url?path=${encodeURIComponent(savedFilePath)}`)
            if (!res.ok) {
              toast.error('다운로드 링크 생성 실패')
              return
            }
            const { url } = await res.json()
            window.open(url, '_blank')
          }}
        >
          <FileCheck className="h-3.5 w-3.5 shrink-0" />
          <span>저장된 해설지 있음 · <span className="font-mono opacity-70">{savedFilePath.split('/').pop()}</span></span>
        </div>
      )}

      {status.type === 'loading' ? (
        <AnswerParseProgress elapsed={elapsed} />
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-8 transition-colors hover:border-primary/50 hover:bg-gray-50"
        >
          {file ? (
            <>
              <FileText className="h-8 w-8 text-primary" />
              <p className="text-sm font-medium text-gray-700">{file.name}</p>
              <p className="text-xs text-gray-400">다른 파일로 변경하려면 클릭</p>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-gray-300" />
              <p className="text-sm text-gray-400">클릭하여 파일 선택 (PDF / 이미지)</p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={handleFile}
          />
        </div>
      )}

      {file && status.type !== 'done' && status.type !== 'loading' && (
        <Button className="w-full" onClick={handleUpload}>
          <Upload className="mr-2 h-4 w-4" />
          {savedFilePath ? '해설지 다시 등록' : '해설지 등록하기'}
        </Button>
      )}

      {status.type === 'done' && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium text-green-800">
            <CheckCircle2 className="h-4 w-4" />
            완료
          </div>
          <p className="text-xs text-green-700">
            {status.questions_parsed}문항 정답 저장
            {status.students_regraded > 0 && ` · ${status.students_regraded}명 재채점`}
          </p>
          {status.subjective_grading_failed && (
            <p className="text-xs text-amber-600">서술형 AI 채점은 실패했습니다 (데이터는 저장됨)</p>
          )}
          <Button
            size="sm"
            variant="outline"
            className="mt-2 w-full"
            onClick={() => {
              setFile(null)
              setParseMode('auto')
              setStatus(weekId, { type: 'idle' })
              if (inputRef.current) inputRef.current.value = ''
            }}
          >
            다른 파일 업로드
          </Button>
        </div>
      )}

      {status.type === 'error' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-xs text-red-700">{status.message}</p>
        </div>
      )}
    </div>
  )
}
