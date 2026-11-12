'use client'

import { useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { runWithLoading } from '@/lib/async-ui'
import { useCaptureRuntime } from './capture-runtime'
import { requireExamPhotoPath } from '@/lib/exam-photo'

export type ExamOcrResult = {
  question_number: number
  sub_label: string | null
  student_answer?: number
  student_answer_text?: string
}

export function ExamPhotoButton({ weekId, studentId, disabled, onResult }: {
  weekId: string
  studentId: string
  disabled: boolean
  onResult: (results: ExamOcrResult[], photoPath: string) => void
}) {
  const { request, compress, pickFiles } = useCaptureRuntime()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    await processFile(file)
  }

  async function processFile(file: File) {
    setError(null)
    await runWithLoading(setLoading, async () => {
      // 원본(폰 사진 3~6MB)을 그대로 보내면 exam-photos 에 그대로 쌓이고 요청 본문도 4/3 로 커진다 —
      // 일괄 판독 다이얼로그와 같은 압축을 태운다.
      const { base64: b64, mimeType } = await compress(file)
      const resp = await request(`/api/weeks/${weekId}/ocr-exam-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData: b64, mimeType, studentId }),
      })
      const data = await resp.json()
      if (resp.ok && data.ok) {
        try {
          const photoPath = requireExamPhotoPath(weekId, studentId, data.photoPath)
          onResult(data.results, photoPath)
        } catch (error) {
          setError(error instanceof Error ? error.message : '사진 저장 확인 실패')
        }
      } else {
        setError(data.error ?? 'OCR 실패')
      }
    }, () => setError('네트워크 오류'))
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
      <button
        type="button"
        disabled={disabled || loading}
        onClick={async () => { if (pickFiles) { const files = await pickFiles(false); if (files[0]) await processFile(files[0]) } else fileRef.current?.click() }}
        className={cn(
          'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors shrink-0',
          disabled || loading
            ? 'text-gray-300 cursor-not-allowed'
            : 'text-emerald-600 hover:bg-emerald-50'
        )}
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
        {loading ? 'OCR 중...' : '답안지 촬영'}
      </button>
      {error && <span role="alert" className="text-xs text-red-500">{error}</span>}
    </>
  )
}
