'use client'

import { FileUpload } from '@/components/ui/file-upload'

import { useRef, useState } from 'react'


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
      <div className="flex flex-wrap gap-2">
      <FileUpload compact className="[&_button]:min-h-12" label="카메라로 촬영" accept="image/*" capture="environment" onChange={handleFile} disabled={disabled} loading={loading} />
      <FileUpload compact className="[&_button]:min-h-12" label={loading ? 'OCR 중...' : '사진 선택'} accept="image/*" inputRef={fileRef} onChange={handleFile} disabled={disabled} loading={loading} />
      </div>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </>
  )
}
