'use client'

import { Camera, ImagePlus } from 'lucide-react'
import { FileUpload } from '@/components/ui/file-upload'

import { useRef, useState } from 'react'
import { runWithLoading } from '@/lib/async-ui'
import { useCaptureRuntime } from './capture-runtime'
import { requireExamPhotoPath } from '@/lib/exam-photo'
import { packExamPhotos } from '@/lib/exam-photo-upload'

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
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length) await processFiles(files)
  }

  async function processFiles(files: File[]) {
    setError(null)
    await runWithLoading(setLoading, async () => {
      let upload
      try {
        upload = await packExamPhotos(await Promise.all(files.map((file) => compress(file, { forceJpeg: files.length > 1 }))))
      } catch (error) {
        setError(error instanceof Error ? error.message : '답안지 파일을 읽지 못했습니다.')
        return
      }
      const resp = await request(`/api/weeks/${weekId}/ocr-exam-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData: upload.base64, mimeType: upload.mimeType, studentId }),
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

  const beforeSelect = (multiple: boolean) => () => {
    if (!pickFiles) return true
    void pickFiles(multiple).then((files) => { if (files.length) return processFiles(files) })
    return false
  }
  return (<div className="flex flex-wrap gap-2 [&_button]:min-h-12">
    <FileUpload compact iconOnly icon={<Camera aria-hidden="true" className="size-5" />} label="카메라로 촬영" accept="image/*" capture="environment" onChange={handleFile} disabled={disabled} loading={loading} beforeSelect={beforeSelect(false)}/>
    <FileUpload compact iconOnly icon={<ImagePlus aria-hidden="true" className="size-5" />} label={loading ? 'OCR 중...' : '사진 선택'} accept="image/*,application/pdf" multiple inputRef={fileRef} onChange={handleFile} disabled={disabled} loading={loading} beforeSelect={beforeSelect(true)}/>
    {error && <span role="alert" className="text-xs text-red-500">{error}</span>}
  </div>)
}
