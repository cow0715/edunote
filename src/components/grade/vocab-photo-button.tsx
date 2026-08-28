'use client'

import { useRef, useState } from 'react'
import { Camera, Loader2, RefreshCw } from 'lucide-react'
import { cn, formatNumberRanges } from '@/lib/utils'
import { compressImageForUpload } from '@/lib/image-compress'
import { runWithLoading } from '@/lib/async-ui'

export type VocabResult = { number: number; english_word: string; student_answer: string; is_correct: boolean }

export function VocabPhotoButton({ weekId, studentId, disabled, hasExistingData, onResult }: {
  weekId: string
  studentId: string
  disabled: boolean
  hasExistingData: boolean
  onResult: (vocabCorrect: number, total: number, results: VocabResult[]) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 채점은 성공했지만 시험지 문항 일부를 못 읽은 경우 — 재촬영 유도 (조용한 결손 방지)
  const [warning, setWarning] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function handleClick() {
    if (hasExistingData) {
      const ok = window.confirm('이미 채점된 데이터가 있습니다.\n재촬영하면 교사 확정(잠금) 항목을 제외한 기존 결과가 덮어씌워집니다.\n계속하시겠습니까?')
      if (!ok) return
    }
    fileRef.current?.click()
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setError(null)
    setWarning(null)
    await runWithLoading(setLoading, async () => {
      // 업로드 전 압축 (긴 변 1600 · JPEG 80%). Storage 용량 + 전송/OCR 시간 절약
      const { base64: b64, mimeType } = await compressImageForUpload(file)
      const resp = await fetch(`/api/weeks/${weekId}/grade-vocab-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, fileData: b64, mimeType }),
      })
      const data = await resp.json()
      if (data.ok) {
        const missing: number[] = data.missing_numbers ?? []
        if (missing.length > 0) {
          setWarning(`${missing.length}문항을 읽지 못했습니다 (${formatNumberRanges(missing)}) — 사진을 확인하고 재촬영해주세요`)
        }
        onResult(data.vocab_correct, data.vocab_total, data.results)
      } else {
        setError(data.error ?? '채점 실패')
      }
    }, () => setError('네트워크 오류'))
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFile} />
      <button
        type="button"
        disabled={disabled || loading}
        onClick={handleClick}
        className={cn(
          'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors shrink-0',
          disabled || loading ? 'text-gray-300 cursor-not-allowed' : 'text-indigo-500 hover:bg-indigo-50'
        )}
      >
        {loading
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : hasExistingData
            ? <RefreshCw className="h-3 w-3" />
            : <Camera className="h-3 w-3" />
        }
        {loading ? '채점 중...' : hasExistingData ? '재채점' : '사진 채점'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
      {warning && <span className="text-xs font-medium text-amber-600">⚠ {warning}</span>}
    </>
  )
}
