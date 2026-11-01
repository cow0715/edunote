'use client'

import { FileUpload } from '@/components/ui/file-upload'

import { useRef, useState } from 'react'
import { formatNumberRanges } from '@/lib/utils'
import { useCaptureRuntime } from './capture-runtime'
import { runWithLoading } from '@/lib/async-ui'

export type VocabResult = { number: number; english_word: string; student_answer: string; is_correct: boolean }

export function VocabPhotoButton({ weekId, studentId, disabled, hasExistingData, onResult }: {
  weekId: string
  studentId: string
  disabled: boolean
  hasExistingData: boolean
  onResult: (vocabCorrect: number, total: number, results: VocabResult[]) => void
}) {
  const { request, compress, pickFiles } = useCaptureRuntime()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 채점은 성공했지만 시험지 문항 일부를 못 읽은 경우 — 재촬영 유도 (조용한 결손 방지)
  const [warning, setWarning] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    await processFile(file)
  }

  async function processFile(file: File) {
    setError(null)
    setWarning(null)
    await runWithLoading(setLoading, async () => {
      // 업로드 전 압축 (긴 변 1600 · JPEG 80%). Storage 용량 + 전송/OCR 시간 절약
      const { base64: b64, mimeType } = await compress(file)
      const resp = await request(`/api/weeks/${weekId}/grade-vocab-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, fileData: b64, mimeType }),
      })
      const data = await resp.json()
      if (resp.ok && data.ok) {
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

const beforeSelect = () => { if (!pickFiles) return true; void pickFiles(false).then(files => { if (files[0]) return processFile(files[0]) }); return false }
  return (<div className="flex flex-wrap gap-2 [&_button]:min-h-12">
    <FileUpload compact label="카메라로 촬영 채점" accept="image/*" capture="environment" onChange={handleFile} disabled={disabled} loading={loading} beforeSelect={beforeSelect}/>
    <FileUpload compact label={loading ? '채점 중...' : hasExistingData ? '파일로 재채점' : '사진·PDF 선택 채점'} accept="image/*,application/pdf" inputRef={fileRef} onChange={handleFile} disabled={disabled} loading={loading} beforeSelect={beforeSelect}/>
    {error && <span role="alert" className="text-xs text-red-500">{error}</span>}
    {warning && <span className="text-xs text-amber-600">{warning}</span>}
  </div>)
}
