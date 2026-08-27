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
// 저장 버튼 하나로 해설 추출 → AI 풀이·어휘 생성까지 이어서 실행한다 (별도 생성 버튼 없음).
// 해석·출제의도는 PDF 원문 그대로 저장되고 생성 단계는 풀이·어휘만 채운다.

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
  const [phase, setPhase] = useState('')

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
      setPhase('')
    }, async () => {
      setPhase('해설 추출 + AI 풀이·어휘 보완을 한 번에 처리하고 있습니다.')
      const storagePath = await uploadToStorage(file)
      const { ok: pdfOk, data } = await safeJson(
        await fetch(`/api/exam-bank/${examId}/upload-explanation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath }),
        })
      )
      if (!pdfOk) throw new Error((data.error as string) || '해설 파싱 실패')
      toast.success(`해설 ${data.updated}/${data.total}문항 적용 완료 (AI 풀이·어휘 포함)`)
      const skipped = Array.isArray(data.skipped_questions) ? data.skipped_questions as number[] : []
      if (skipped.length > 0) {
        toast.warning(`${skipped.join(', ')}번은 콘텐츠 필터로 건너뛰었습니다 — 해당 문항만 직접 입력해주세요.`)
      }

      queryClient.invalidateQueries({ queryKey: ['exam-bank-questions', examId] })
      queryClient.invalidateQueries({ queryKey: ['exam-bank-search'] })
      onOpenChange(false)
      setFileName('')
      if (fileRef.current) fileRef.current.value = ''
    }, (e) => toast.error(errorMessage(e, '해설 PDF 파싱 실패')))
  }

  return (
    <Dialog open={!!examId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>해설 PDF 업로드</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-gray-500">
          해설 PDF에서 출제의도·해석·풀이를 추출해 문항에 연결하고, 이어서 AI가 풀이·어휘를 보완합니다.
          해석은 PDF 원문 그대로 저장됩니다.
        </p>
        <div className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
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
                <p className="text-sm font-medium text-amber-900">{phase || '처리 중...'}</p>
                <span className="text-xs text-amber-600">{elapsed}초</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-amber-200">
                <div
                  className="h-1.5 rounded-full bg-amber-500 transition-all duration-1000"
                  style={{ width: `${Math.min((elapsed / 240) * 100, 95)}%` }}
                />
              </div>
            </div>
          )}

          <Button className="w-full" onClick={handleUpload} disabled={uploading}>
            {uploading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />처리 중...</>
            ) : (
              <><BookOpen className="mr-2 h-4 w-4" />해설 저장 + AI 보완</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
