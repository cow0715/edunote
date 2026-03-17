'use client'

import { useRef, useState } from 'react'
import { Upload, CheckCircle2, AlertTriangle, Loader2, FileText, FileCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

interface Props {
  weekId: string
  savedFilePath?: string | null
}

type Status =
  | { type: 'idle' }
  | { type: 'loading'; step: string }
  | { type: 'done'; questions_parsed: number; students_regraded: number; subjective_grading_failed?: boolean }
  | { type: 'error'; message: string }

export function AnswerSheetUploader({ weekId, savedFilePath }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<Status>({ type: 'idle' })
  const qc = useQueryClient()

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setStatus({ type: 'idle' })
  }

  async function handleUpload() {
    if (!file) return

    setStatus({ type: 'loading', step: 'Claude가 해설지를 읽는 중...' })

    try {
      const base64 = await readFileAsBase64(file)

      setStatus({ type: 'loading', step: '정답 추출 중...' })

      const res = await fetch(`/api/weeks/${weekId}/parse-answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData: base64, mimeType: file.type, fileName: file.name }),
      })

      const data = await res.json()

      if (!res.ok) {
        setStatus({ type: 'error', message: data.error ?? '처리 실패' })
        return
      }

      setStatus({
        type: 'done',
        questions_parsed: data.questions_parsed,
        students_regraded: data.students_regraded,
        subjective_grading_failed: data.subjective_grading_failed,
      })

      qc.invalidateQueries({ queryKey: ['exam-questions', weekId] })
      qc.invalidateQueries({ queryKey: ['grade', weekId] })
      qc.invalidateQueries({ queryKey: ['week', weekId] })

      toast.success(`${data.questions_parsed}문항 파싱 완료${data.students_regraded > 0 ? `, ${data.students_regraded}명 재채점` : ''}`)
    } catch (e) {
      setStatus({ type: 'error', message: e instanceof Error ? e.message : '오류 발생' })
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        PDF 또는 이미지 형식의 답안해설지를 업로드하면 Claude가 정답을 추출합니다.
        재업로드 시 기존 학생 답안은 유지되고 정답만 업데이트됩니다.
      </p>

      {/* 저장된 파일 표시 */}
      {savedFilePath && status.type !== 'done' && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
          <FileCheck className="h-3.5 w-3.5 shrink-0" />
          <span>저장된 해설지 있음 · <span className="font-mono opacity-70">{savedFilePath.split('/').pop()}</span></span>
        </div>
      )}

      {/* 파일 선택 영역 */}
      <div
        onClick={() => inputRef.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-8 transition-colors hover:border-primary/50 hover:bg-gray-50"
      >
        <Upload className="h-8 w-8 text-gray-300" />
        {file ? (
          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <FileText className="h-4 w-4 text-primary" />
            {file.name}
          </div>
        ) : (
          <p className="text-sm text-gray-400">클릭하여 파일 선택 (PDF / 이미지)</p>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={handleFile}
        />
      </div>

      {/* 업로드 버튼 */}
      {file && status.type !== 'done' && (
        <Button
          className="w-full"
          onClick={handleUpload}
          disabled={status.type === 'loading'}
        >
          {status.type === 'loading' ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {status.step}
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              {savedFilePath ? '해설지 다시 등록' : '해설지 등록하기'}
            </>
          )}
        </Button>
      )}

      {/* 결과 */}
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
            onClick={() => { setFile(null); setStatus({ type: 'idle' }); if (inputRef.current) inputRef.current.value = '' }}
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

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
