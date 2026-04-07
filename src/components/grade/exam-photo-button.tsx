'use client'

import { useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ExamOcrResult = {
  question_number: number
  sub_label: string | null
  student_answer?: number
  student_answer_text?: string
}

export function ExamPhotoButton({ weekId, side, disabled, onResult }: {
  weekId: string
  side: 'front' | 'back'
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
    setLoading(true)
    setError(null)
    try {
      const b64 = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.readAsDataURL(file)
      })
      const resp = await fetch(`/api/weeks/${weekId}/ocr-exam-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData: b64, mimeType: file.type }),
      })
      const data = await resp.json()
      if (data.ok) {
        onResult(data.results)
      } else {
        setError(data.error ?? 'OCR 실패')
      }
    } catch {
      setError('네트워크 오류')
    } finally {
      setLoading(false)
    }
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
        {loading ? 'OCR 중...' : `${side === 'front' ? '앞면' : '뒷면'} 촬영`}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </>
  )
}
