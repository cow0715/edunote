'use client'

import { useState, useRef } from 'react'
import { errorMessage, runOrReport } from '@/lib/async-ui'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Upload, Loader2, Sparkles, FolderOpen, CheckCircle2, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { safeJson, confirmAiWork } from './constants'
import type { ExamBank } from './types'

// ── 일괄 해설 업로드 다이얼로그 ───────────────────────────────────────────
// 파일명 규칙: YYYY_MM_G.pdf (예: 2025_06_3.pdf = 2025년 6월 고3)

type BulkItem = {
  file: File
  exam: ExamBank | null      // 매칭된 시험
  status: 'pending' | 'processing' | 'done' | 'error'
  message: string
}

function parseBulkFilename(name: string): { year: number; month: number; grade: number } | null {
  // YYYY_MM_G 또는 YYYY_M_G
  const m = name.match(/(\d{4})_(\d{1,2})_(\d)/)
  if (!m) return null
  return { year: parseInt(m[1]), month: parseInt(m[2]), grade: parseInt(m[3]) }
}

export function BulkExplanationDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<BulkItem[]>([])
  const [running, setRunning] = useState(false)
  const [current, setCurrent] = useState(0)

  const { data: exams } = useQuery<ExamBank[]>({
    queryKey: ['exam-bank'],
    queryFn: () => fetch('/api/exam-bank').then((r) => r.json()),
    enabled: open,
  })

  const handleFiles = (files: FileList | null) => {
    if (!files || !exams) return
    const arr = Array.from(files).filter((f) => f.name.endsWith('.pdf'))
    const newItems: BulkItem[] = arr.map((file) => {
      const parsed = parseBulkFilename(file.name)
      const exam = parsed
        ? (exams.find(
            (e) => e.exam_year === parsed.year && e.exam_month === parsed.month && e.grade === parsed.grade,
          ) ?? null)
        : null
      return { file, exam, status: 'pending', message: exam ? `${exam.title}` : '매칭 실패 — 파일명 확인' }
    })
    setItems(newItems)
  }

  const handleRun = async (useVision = false) => {
    const matched = items.filter((it) => it.exam)
    if (!matched.length) return toast.error('매칭된 시험이 없습니다')
    if (useVision && !confirmAiWork()) return

    setRunning(true)
    setCurrent(0)

    const pdfEndpoint = useVision ? 'upload-explanation-vision' : 'upload-explanation'

    // entries() 로 도는 이유: `i++` 로 증가하는 변수를 아래 setItems 람다들이 붙잡으면
    // React Compiler 가 이 컴포넌트를 최적화에서 제외한다(UpdateExpression captured in lambda).
    for (const [index, it] of items.entries()) {
      const exam = it.exam
      if (!exam) continue

      setCurrent(index + 1)
      setItems((prev) => prev.map((x, idx) => idx === index ? { ...x, status: 'processing' } : x))

      await runOrReport(async () => {
        const supabase = createClient()
        const safeFileName = it.file.name.replace(/[^\w.\-]/g, '_')
        const storagePath = `${Date.now()}_bulk_${safeFileName}`
        const { error: uploadErr } = await supabase.storage
          .from('exam-pdf-temp')
          .upload(storagePath, it.file, { contentType: 'application/pdf' })
        if (uploadErr) throw new Error(`업로드 실패: ${uploadErr.message}`)

        // PDF 파싱
        const { ok: pdfOk, data } = await safeJson(
          await fetch(`/api/exam-bank/${exam.id}/${pdfEndpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storagePath }),
          })
        )
        if (!pdfOk) throw new Error((data.error as string) || '파싱 실패')

        const label = useVision ? 'Vision' : 'PDF'
        const msg = `${label} ${data.updated}/${data.total}문항 완료`

        setItems((prev) => prev.map((x, idx) => idx === index ? { ...x, status: 'done', message: msg } : x))
      }, (e) => {
        const msg = errorMessage(e, '오류')
        setItems((prev) => prev.map((x, idx) => idx === index ? { ...x, status: 'error', message: msg } : x))
      })
    }

    setRunning(false)
    toast.success('일괄 처리 완료')
  }

  const matchedCount = items.filter((it) => it.exam).length
  const doneCount = items.filter((it) => it.status === 'done').length

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!running) { onOpenChange(v); if (!v) setItems([]) } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>일괄 해설 업로드</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700 space-y-1">
            <p className="font-semibold">파일명 규칙: <code>YYYY_MM_G.pdf</code></p>
            <p>예시: <code>2025_06_3.pdf</code> → 2025년 6월 고3 / <code>2025_11_3.pdf</code> → 2025년 11월 수능</p>
          </div>

          <input ref={fileRef} type="file" accept=".pdf" multiple className="hidden"
            onChange={(e) => handleFiles(e.target.files)} />

          {items.length === 0 ? (
            <button
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-8 text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
            >
              <FolderOpen className="h-8 w-8" />
              <span className="text-sm">PDF 파일 여러 개 선택</span>
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{items.length}개 파일 · 매칭 {matchedCount}개</span>
                <button onClick={() => { setItems([]); if (fileRef.current) fileRef.current.value = '' }}
                  className="text-gray-400 hover:text-gray-600">다시 선택</button>
              </div>

              <div className="max-h-64 overflow-auto space-y-1.5 pr-1">
                {items.map((it, i) => (
                  <div key={i} className="flex items-center gap-2.5 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs">
                    {it.status === 'pending' && (it.exam
                      ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                      : <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                    )}
                    {it.status === 'processing' && <Loader2 className="h-4 w-4 shrink-0 text-blue-500 animate-spin" />}
                    {it.status === 'done' && <CheckCircle2 className="h-4 w-4 shrink-0 text-blue-600" />}
                    {it.status === 'error' && <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                    <div className="min-w-0">
                      <p className="font-medium text-gray-700 truncate">{it.file.name}</p>
                      <p className={`truncate ${it.exam ? 'text-gray-400' : 'text-red-400'} ${it.status === 'done' ? 'text-blue-500' : ''} ${it.status === 'error' ? 'text-red-500' : ''}`}>
                        {it.message}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {running && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>처리 중... ({doneCount}/{matchedCount})</span>
                    <span>{Math.round((doneCount / matchedCount) * 100)}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-gray-200">
                    <div
                      className="h-1.5 rounded-full bg-blue-500 transition-all duration-500"
                      style={{ width: `${(doneCount / matchedCount) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => handleRun(false)} disabled={running || matchedCount === 0}>
                  {running
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{current}/{matchedCount} 처리 중...</>
                    : <><Upload className="mr-2 h-4 w-4" />일괄 처리</>
                  }
                </Button>
                <Button variant="outline" onClick={() => handleRun(true)} disabled={running || matchedCount === 0} title="텍스트 추출 실패 PDF용 — Claude Vision으로 직접 파싱 (느림)">
                  {running
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <><Sparkles className="mr-1.5 h-4 w-4 text-purple-500" />Vision</>
                  }
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
