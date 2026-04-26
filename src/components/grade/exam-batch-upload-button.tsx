'use client'

import { useRef, useState } from 'react'
import { Files, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ExamOcrResult } from './exam-photo-button'

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = () => reject(new Error('파일을 읽는 중 오류가 발생했습니다.'))
    reader.readAsDataURL(file)
  })
}

export function ExamBatchUploadButton({ weekId, disabled, onResult }: {
  weekId: string
  disabled: boolean
  onResult: (results: ExamOcrResult[]) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? [])
    if (!selectedFiles.length) return

    event.target.value = ''
    setLoading(true)
    setError(null)

    try {
      const files = await Promise.all(selectedFiles.map(async (file) => ({
        fileData: await readFileAsBase64(file),
        mimeType: file.type,
        fileName: file.name,
      })))

      const resp = await fetch(`/api/weeks/${weekId}/ocr-exam-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      })
      const data = await resp.json()
      if (data.ok) {
        onResult(data.results)
      } else {
        setError(data.error ?? 'OCR 실패')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '업로드 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf,image/*"
        className="hidden"
        onChange={handleFiles}
      />
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
          disabled || loading
            ? 'cursor-not-allowed text-slate-300'
            : 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400'
        )}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Files className="h-3.5 w-3.5" />}
        {loading ? '시험지 분석 중...' : '시험지 묶음 업로드'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </>
  )
}
