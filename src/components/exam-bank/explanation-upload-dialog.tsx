'use client'

import { useState, useRef } from 'react'
import { errorMessage, runWithLoading } from '@/lib/async-ui'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { File, Loader2, BookOpen } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { safeJson } from './constants'

// ── 해설 PDF 업로드 다이얼로그 ──────────────────────────────────────────────

export function ExplanationUploadDialog({
  examId,
  onOpenChange,
}: {
  examId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [preview, setPreview] = useState<{ rawTextPreview: string; parsed: { question_number: number; intent: string; translation: string; solution: string; vocabulary: string }[]; parsedCount: number } | null>(null)

  const uploadToStorage = async (file: File) => {
    const supabase = createClient()
    const safeFileName = file.name.replace(/[^\w.\-]/g, '_')
    const storagePath = `${Date.now()}_explanation_${safeFileName}`
    const { error: uploadErr } = await supabase.storage
      .from('exam-pdf-temp')
      .upload(storagePath, file, { contentType: file.type || 'application/pdf' })
    if (uploadErr) throw new Error(`파일 업로드 실패: ${uploadErr.message}`)
    return storagePath
  }

  const handlePreview = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file || !examId) return toast.error('PDF 파일을 선택해주세요')

    setElapsed(0)
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000)

    // 끝나면 타이머 정리 + 경과 초 리셋 (기존 finally 와 동일)
    await runWithLoading((loading) => {
      setUploading(loading)
      if (loading) return
      clearInterval(timer)
      setElapsed(0)
    }, async () => {
      const storagePath = await uploadToStorage(file)
      const { ok, data } = await safeJson(
        await fetch(`/api/exam-bank/${examId}/debug-explanation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath }),
        })
      )
      if (!ok) throw new Error((data.error as string) || '파싱 실패')
      setPreview(data as Parameters<typeof setPreview>[0])
    }, (e) => toast.error(errorMessage(e, '파싱 미리보기 실패')))
  }

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file || !examId) return toast.error('PDF 파일을 선택해주세요')

    setElapsed(0)
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000)

    // 끝나면 타이머 정리 + 경과 초 리셋 (기존 finally 와 동일)
    await runWithLoading((loading) => {
      setUploading(loading)
      if (loading) return
      clearInterval(timer)
      setElapsed(0)
    }, async () => {
      const storagePath = await uploadToStorage(file)
      const { ok: pdfOk, data } = await safeJson(
        await fetch(`/api/exam-bank/${examId}/upload-explanation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath }),
        })
      )
      if (!pdfOk) throw new Error((data.error as string) || '해설 파싱 실패')
      toast.success(`PDF 해설 ${data.updated}/${data.total}문항 적용 완료`)
      queryClient.invalidateQueries({ queryKey: ['exam-bank-questions', examId] })
      queryClient.invalidateQueries({ queryKey: ['exam-bank-search'] })
      onOpenChange(false)
      setFileName('')
      setPreview(null)
      if (fileRef.current) fileRef.current.value = ''
    }, (e) => toast.error(errorMessage(e, '해설 PDF 파싱 실패')))
  }

  return (
    <Dialog open={!!examId} onOpenChange={(open) => { if (!open) setPreview(null); onOpenChange(open) }}>
      <DialogContent className={preview ? 'max-w-2xl' : 'max-w-sm'}>
        <DialogHeader>
          <DialogTitle>해설 PDF 업로드</DialogTitle>
        </DialogHeader>

        {!preview ? (
          <>
            <p className="text-sm text-gray-500">
              해설 PDF를 업로드하면 [출제의도], [해석], [풀이], [Words and Phrases]를 자동으로 추출하여 문항에 연결합니다.
            </p>
            <div className="space-y-3">
              <input
                ref={fileRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => { setFileName(e.target.files?.[0]?.name ?? ''); setPreview(null) }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full items-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 hover:border-gray-400 hover:bg-gray-50 transition-colors"
              >
                <File className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="truncate">{fileName || '해설 PDF 파일 선택'}</span>
              </button>

              {uploading && (
                <div className="rounded-lg border bg-amber-50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-amber-900">파싱 중...</p>
                    <span className="text-xs text-amber-600">{elapsed}초</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-amber-200">
                    <div
                      className="h-1.5 rounded-full bg-amber-500 transition-all duration-1000"
                      style={{ width: `${Math.min((elapsed / 30) * 100, 95)}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={handlePreview} disabled={uploading}>
                  {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  파싱 미리보기
                </Button>
                <Button className="flex-1" onClick={handleUpload} disabled={uploading}>
                  {uploading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />저장 중...</>
                  ) : (
                    <><BookOpen className="mr-2 h-4 w-4" />해설 저장</>
                  )}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">
                파싱 결과: <span className="text-blue-600 font-semibold">{preview.parsedCount}개 문항</span>
              </p>
              <button
                onClick={() => setPreview(null)}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                ← 다시 선택
              </button>
            </div>

            {/* 원시 텍스트 미리보기 */}
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-500 hover:text-gray-700 mb-1">원시 텍스트 (앞 3000자)</summary>
              <pre className="max-h-40 overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-600 whitespace-pre-wrap">
                {preview.rawTextPreview}
              </pre>
            </details>

            {/* 파싱된 문항 목록 */}
            <div className="max-h-80 overflow-auto space-y-2 pr-1">
              {preview.parsed.map((p) => (
                <div key={p.question_number} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs space-y-1">
                  <p className="font-semibold text-gray-800">{p.question_number}번</p>
                  {p.intent && <p><span className="text-gray-400">출제의도</span> {p.intent}</p>}
                  {p.translation && (
                    <p className="line-clamp-2"><span className="text-gray-400">해석</span> {p.translation}</p>
                  )}
                  {!p.translation && <p className="text-red-400">해석 없음</p>}
                  {p.vocabulary && (
                    <p className="line-clamp-1"><span className="text-gray-400">어휘</span> {p.vocabulary}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setPreview(null)}>
                다시 선택
              </Button>
              <Button className="flex-1" onClick={handleUpload} disabled={uploading}>
                {uploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />저장 중...</> : '이대로 저장'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
