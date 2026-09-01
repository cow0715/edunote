'use client'

import { useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { runWithLoading } from '@/lib/async-ui'
import { compressImageForUpload } from '@/lib/image-compress'

export type ExamOcrResult = {
  question_number: number
  sub_label: string | null
  student_answer?: number
  student_answer_text?: string
}

export function ExamPhotoButton({ weekId, studentId, disabled, onResult }: {
  weekId: string
  /** 있으면 서버가 사진을 exam-photos 에 보관한다 (원본 확인·재판독용) */
  studentId?: string
  disabled: boolean
  onResult: (results: ExamOcrResult[]) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setError(null)
    await runWithLoading(setLoading, async () => {
      // 원본(폰 사진 3~6MB)을 그대로 보내면 exam-photos 에 그대로 쌓이고 요청 본문도 4/3 로 커진다 —
      // 일괄 판독 다이얼로그와 같은 압축을 태운다.
      const { base64: b64, mimeType } = await compressImageForUpload(file)
      const resp = await fetch(`/api/weeks/${weekId}/ocr-exam-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData: b64, mimeType, studentId }),
      })
      const data = await resp.json()
      if (data.ok) {
        onResult(data.results)
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
        onClick={() => fileRef.current?.click()}
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
      {error && <span className="text-xs text-red-400">{error}</span>}
    </>
  )
}
