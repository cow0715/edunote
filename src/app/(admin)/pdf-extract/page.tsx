'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Upload, Copy, Loader2, FileText, X } from 'lucide-react'

export default function PdfExtractPage() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function pickFile(f: File | null) {
    if (!f) return
    if (f.type !== 'application/pdf') {
      toast.error('PDF 파일만 업로드 가능합니다')
      return
    }
    setFile(f)
    setResult('')
  }

  async function handleExtract() {
    if (!file) return
    setLoading(true)
    setResult('')
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/pdf-extract', {
        method: 'POST',
        body: formData,
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
    }
  }

  async function handleCopy() {
    if (!result) return
    await navigator.clipboard.writeText(result)
    toast.success('클립보드에 복사되었습니다')
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">PDF 텍스트 추출</h1>
        <p className="mt-1 text-sm text-gray-600">
          시험지 PDF를 업로드하면 한글(HWP)에 붙여넣기 좋은 텍스트로 변환합니다.
        </p>
      </div>

      <Card className="p-6">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            pickFile(e.dataTransfer.files[0] ?? null)
          }}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 transition-colors ${
            dragOver ? 'border-primary bg-primary/5' : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div className="flex items-center gap-3">
              <FileText className="h-6 w-6 text-primary" />
              <div>
                <div className="font-medium text-gray-900">{file.name}</div>
                <div className="text-xs text-gray-500">
                  {(file.size / 1024).toFixed(0)} KB
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  setFile(null)
                  setResult('')
                  if (inputRef.current) inputRef.current.value = ''
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <>
              <Upload className="h-10 w-10 text-gray-400" />
              <p className="mt-3 text-sm font-medium text-gray-700">
                PDF 파일을 드래그하거나 클릭하여 선택
              </p>
              <p className="mt-1 text-xs text-gray-500">시험지 PDF (10페이지 내외 권장)</p>
            </>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={handleExtract} disabled={!file || loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                추출 중... (1~3분 소요)
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
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!result}
            >
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
