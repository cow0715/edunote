'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Upload, Copy, Loader2, FileText, X, Image } from 'lucide-react'

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

async function resizeImageToBlob(file: File, maxPx = 2000, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('변환 실패')), 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지 로드 실패')) }
    img.src = url
  })
}

async function imagesToPdf(files: File[]): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib')
  const pdfDoc = await PDFDocument.create()

  for (const file of files) {
    const resized = await resizeImageToBlob(file)
    const imgBytes = await resized.arrayBuffer()
    const pdfImage = await pdfDoc.embedJpg(imgBytes)
    const page = pdfDoc.addPage([pdfImage.width, pdfImage.height])
    page.drawImage(pdfImage, { x: 0, y: 0, width: pdfImage.width, height: pdfImage.height })
  }

  const bytes = await pdfDoc.save()
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
}

export default function PdfExtractPage() {
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [result, setResult] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function pickFiles(incoming: FileList | null) {
    if (!incoming || incoming.length === 0) return
    const arr = Array.from(incoming)

    const invalid = arr.filter((f) => !ACCEPTED_TYPES.includes(f.type))
    if (invalid.length > 0) {
      toast.error('PDF, JPG, PNG, WEBP 파일만 업로드 가능합니다')
      return
    }

    const hasPdf = arr.some((f) => f.type === 'application/pdf')
    const hasImage = arr.some((f) => IMAGE_TYPES.includes(f.type))
    if (hasPdf && hasImage) {
      toast.error('PDF와 이미지를 함께 선택할 수 없습니다')
      return
    }
    if (hasPdf && arr.length > 1) {
      toast.error('PDF는 1개만 선택 가능합니다')
      return
    }

    setFiles(arr)
    setResult('')
    setStatus('')
  }

  function clearFiles() {
    setFiles([])
    setResult('')
    setStatus('')
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleExtract() {
    if (files.length === 0) return
    setLoading(true)
    setResult('')

    try {
      let uploadBlob: Blob

      if (files[0].type === 'application/pdf') {
        uploadBlob = files[0]
      } else {
        setStatus(`이미지 ${files.length}장 변환 중...`)
        uploadBlob = await imagesToPdf(files)
      }

      setStatus('업로드 중...')
      const presignRes = await fetch('/api/pdf-extract/presign', { method: 'POST' })
      if (!presignRes.ok) throw new Error('업로드 URL 발급 실패')
      const { uploadUrl, path } = await presignRes.json()

      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: uploadBlob,
      })
      if (!uploadRes.ok) throw new Error('업로드 실패')

      setStatus('AI 추출 중... (1~3분 소요)')
      const fileNames = isImage ? files.map((f) => f.name) : [files[0].name]
      const res = await fetch('/api/pdf-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, fileNames }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: '추출 실패' }))
        throw new Error(data.error || '추출 실패')
      }

      const text = await res.text()
      setResult(text)
      toast.success('추출 완료')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(msg)
    } finally {
      setLoading(false)
      setStatus('')
    }
  }

  async function handleCopy() {
    if (!result) return
    await navigator.clipboard.writeText(result)
    toast.success('클립보드에 복사되었습니다')
  }

  const isImage = files.length > 0 && IMAGE_TYPES.includes(files[0].type)

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">PDF 텍스트 추출</h1>
        <p className="mt-1 text-sm text-gray-600">
          시험지 PDF 또는 이미지(JPG·PNG·WEBP)를 업로드하면 텍스트로 변환합니다.
        </p>
      </div>

      <Card className="p-6">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            pickFiles(e.dataTransfer.files)
          }}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 transition-colors ${
            dragOver ? 'border-primary bg-primary/5' : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => pickFiles(e.target.files)}
          />
          {files.length > 0 ? (
            <div className="flex w-full flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isImage
                    ? <Image className="h-5 w-5 text-primary" />
                    : <FileText className="h-5 w-5 text-primary" />}
                  <span className="font-medium text-gray-900">
                    {isImage ? `이미지 ${files.length}장` : files[0].name}
                  </span>
                  <span className="text-xs text-gray-500">
                    ({(files.reduce((s, f) => s + f.size, 0) / 1024).toFixed(0)} KB)
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); clearFiles() }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {isImage && (
                <ul className="ml-7 space-y-0.5">
                  {files.map((f, i) => (
                    <li key={i} className="text-xs text-gray-500">{i + 1}. {f.name}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
              <Upload className="h-10 w-10 text-gray-400" />
              <p className="mt-3 text-sm font-medium text-gray-700">
                파일을 드래그하거나 클릭하여 선택
              </p>
              <p className="mt-1 text-xs text-gray-500">PDF 1개 또는 이미지 여러 장 (JPG·PNG·WEBP)</p>
            </>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-3">
          {loading && status && (
            <span className="text-sm text-gray-500">{status}</span>
          )}
          <Button onClick={handleExtract} disabled={files.length === 0 || loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                처리 중...
              </>
            ) : (
              '추출 시작'
            )}
          </Button>
        </div>
      </Card>

      {(result || loading) && (
        <Card className="p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">추출 결과</h2>
            <Button variant="outline" size="sm" onClick={handleCopy} disabled={!result}>
              <Copy className="mr-2 h-4 w-4" />
              복사
            </Button>
          </div>
          <Textarea
            value={result}
            onChange={(e) => setResult(e.target.value)}
            placeholder={loading ? '추출 중입니다...' : ''}
            className="min-h-[500px] font-mono text-sm"
          />
          <p className="mt-2 text-xs text-gray-500">
            결과를 직접 수정할 수도 있습니다. 복사 버튼으로 클립보드에 복사하세요.
          </p>
        </Card>
      )}
    </div>
  )
}
