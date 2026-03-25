'use client'

import { useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type VocabResult = { number: number; english_word: string; student_answer: string; is_correct: boolean }

export function VocabPhotoButton({ weekId, studentId, disabled, onResult }: {
  weekId: string
  studentId: string
  disabled: boolean
  onResult: (vocabCorrect: number, total: number, results: VocabResult[]) => void
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
      const resp = await fetch(`/api/weeks/${weekId}/grade-vocab-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, fileData: b64, mimeType: file.type }),
      })
      const data = await resp.json()
      if (data.ok) {
        onResult(data.vocab_correct, data.vocab_total, data.results)
      } else {
        setError(data.error ?? '채점 실패')
      }
    } catch {
      setError('네트워크 오류')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFile} />
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => fileRef.current?.click()}
        className={cn(
          'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors shrink-0',
          disabled || loading ? 'text-gray-300 cursor-not-allowed' : 'text-indigo-500 hover:bg-indigo-50'
        )}
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
        {loading ? '채점 중...' : '사진 채점'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </>
  )
}
