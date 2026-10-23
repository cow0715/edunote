'use client'

import { FileUpload } from '@/components/ui/file-upload'

import { useState, useRef } from 'react'
import { errorMessage, runOrReport, runWithLoading } from '@/lib/async-ui'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Upload, FileText, File} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { MONTHS, safeJson } from './constants'
import { examPdfUploadPath, resolvePdfImport } from '@/lib/pdf-import/client'

// ── 업로드 다이얼로그 ─────────────────────────────────────────────────────
// 신규 등록은 문제지 + 해설지를 함께 받는다. 워커 모드에서는 한 작업이 순차 처리한다.
// 기존 동기 모드에서는 브라우저가 문항 등록 후 해설 API를 호출한다.
// 해설을 나중에 붙이는 경로(시험 카드 📖 · 일괄 해설)는 그대로 남아 있다.
export function UploadDialog({ open, onOpenChange, inline = false, onAccepted }: { open: boolean; onOpenChange: (v: boolean) => void; inline?: boolean; onAccepted?: () => void }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const explanationRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [explanationName, setExplanationName] = useState('')
  const [uploading, setUploading] = useState(false)
  // 해설 단계로 넘어가면 문제지 단계 문구 대신 해설 진행을 보여준다
  const [explaining, setExplaining] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [workerMessage, setWorkerMessage] = useState('')
  const [form, setForm] = useState({
    exam_year: new Date().getFullYear(),
    exam_month: 4,
    grade: 3,
    source: '모의고사',
    form_type: '홀수형',
  })

  const autoTitle = form.source === '수능'
    ? `${form.exam_year}년 ${form.exam_month}월 수능`
    : `${form.exam_year}년 ${form.exam_month}월 고${form.grade} 모의고사`

  // 문제지 파싱 성공 뒤에만 부른다. 여기서 던지면 문항까지 롤백돼 보이므로
  // 실패는 토스트로만 알리고 시험은 살린다 — 해설은 📖 버튼으로 재시도할 수 있다.
  const uploadExplanation = async (examId: string, file: File, existingPath?: string) => {
    const supabase = createClient()
    const safeFileName = file.name.replace(/[^\w.\-]/g, '_')
    const storagePath = existingPath ?? await examPdfUploadPath(supabase, safeFileName)
    const { error: uploadErr } = existingPath ? { error: null } : await supabase.storage
      .from('exam-pdf-temp')
      .upload(storagePath, file, { contentType: file.type || 'application/pdf' })
    if (uploadErr) throw new Error(`해설 파일 업로드 실패: ${uploadErr.message}`)

    const { ok, data: accepted } = await safeJson(
      await fetch(`/api/exam-bank/${examId}/upload-explanation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath }),
      })
    )
    if (!ok) throw new Error((accepted.error as string) || '해설 파싱 실패')
    const data = await resolvePdfImport(accepted, (job) => setWorkerMessage(`${job.stage} · 저장된 처리 결과 ${job.completed_calls}개`))

    toast.success(`해설 ${data.updated}/${data.total}문항 적용 완료 (AI 풀이·어휘 포함)`)
    const skipped = Array.isArray(data.skipped_questions) ? data.skipped_questions as number[] : []
    if (skipped.length > 0) {
      toast.warning(`${skipped.join(', ')}번은 콘텐츠 필터로 건너뛰었습니다 — 해당 문항만 직접 입력해주세요.`)
    }
  }

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) return toast.error('PDF 파일을 선택해주세요')
    const explanationFile = explanationRef.current?.files?.[0]

    setElapsed(0)

    const timer = setInterval(() => setElapsed((s) => s + 1), 1000)

    // 끝나면 타이머·단계 표시를 되돌린다 (기존 finally 와 동일)
    await runWithLoading((loading) => {
      setUploading(loading)
      if (loading) return
      clearInterval(timer)
      setExplaining(false)
      setElapsed(0)
      setWorkerMessage('')
    }, async () => {
      // PDF를 Supabase Storage에 직접 업로드 (Vercel 4.5MB body 한도 우회)
      const supabase = createClient()
      const safeFileName = file.name.replace(/[^\w.\-]/g, '_')
      const storagePath = await examPdfUploadPath(supabase, safeFileName)
      const { error: uploadErr } = await supabase.storage
        .from('exam-pdf-temp')
        .upload(storagePath, file, { contentType: file.type || 'application/pdf' })
      if (uploadErr) throw new Error(`파일 업로드 실패: ${uploadErr.message}`)

      let explanationStoragePath: string | undefined
      if (explanationFile) {
        explanationStoragePath = await examPdfUploadPath(supabase, explanationFile.name)
        const { error } = await supabase.storage.from('exam-pdf-temp').upload(explanationStoragePath, explanationFile, { contentType: 'application/pdf' })
        if (error) throw new Error(`해설 파일 업로드 실패: ${error.message}`)
      }

      const res = await fetch('/api/exam-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          title: autoTitle,
          storagePath,
          mimeType: file.type || 'application/pdf',
          explanationStoragePath,
        }),
      })


      const accepted = await res.json()
      if (!res.ok) throw new Error(accepted.error || '업로드 실패')
      if (typeof accepted.job_id === 'string') {
        await queryClient.invalidateQueries({ queryKey: ['pdf-import-jobs'] })
        toast.success('기출 등록을 접수했습니다. 문제·해설·통계 처리는 등록·처리에서 확인할 수 있습니다.')
        setFileName(''); setExplanationName('')
        if (fileRef.current) fileRef.current.value = ''
        if (explanationRef.current) explanationRef.current.value = ''
        onAccepted?.(); onOpenChange(false)
        return
      }
      const data = await resolvePdfImport(accepted, (job) => {
        setWorkerMessage(`${job.stage} · 저장된 처리 결과 ${job.completed_calls}개`)
      })

      // 콘텐츠 필터에 걸린 페이지는 서버가 페이지 단위로 재파싱하며 건너뛴다. 몇 쪽인지 알려줘야 손으로 채울 수 있다.
      const skipped = Array.isArray(data.skipped_pages) ? data.skipped_pages : []
      const skippedMsg = skipped.length ? ` · ${skipped.join(', ')}번 건너뜀` : ''
      const statsMsg = Number(data.stats_fetched) > 0 ? ` · 메가스터디 통계 ${data.stats_fetched}문항` : ''
      toast.success(`${data.question_count}개 문항 추출 완료${statsMsg}${skippedMsg}`)
      if (data.explanation_result && typeof data.explanation_result === 'object') {
        const explanation = data.explanation_result as { updated?: number; skipped_questions?: number[] }
        toast.success(`해설 ${explanation.updated ?? 0}문항 반영 완료`)
        if (explanation.skipped_questions?.length) toast.warning(`해설 ${explanation.skipped_questions.join(', ')}번은 인식하지 못했습니다.`)
      }

      // 2단계 — 해설지를 같이 골랐으면 이어서. 실패해도 1단계 결과는 유지한다.
      if (explanationFile && !accepted.job_id) {
        setExplaining(true)
        await runOrReport(
          () => uploadExplanation(data.exam_id as string, explanationFile, explanationStoragePath),
          (e) => toast.error(`${errorMessage(e, '해설 파싱 실패')} — 문항은 저장됐습니다. 시험 카드의 해설 버튼으로 다시 시도해주세요.`),
        )
      }

      queryClient.invalidateQueries({ queryKey: ['exam-bank'] })
      queryClient.invalidateQueries({ queryKey: ['exam-bank-search'] })
      onOpenChange(false)
      setForm({ exam_year: new Date().getFullYear(), exam_month: 4, grade: 3, source: '모의고사', form_type: '홀수형' })
      setFileName('')
      setExplanationName('')
      if (fileRef.current) fileRef.current.value = ''
      if (explanationRef.current) explanationRef.current.value = ''
    }, (e) => toast.error(errorMessage(e, 'PDF 파싱 실패')))
  }

  const content = (
        <fieldset disabled={uploading} className="space-y-3">
          {/* 년 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-muted-foreground">년</Label>
            <Input
              aria-label="시행년"
              type="number"
              value={form.exam_year}
              onChange={(e) => setForm({ ...form, exam_year: Number(e.target.value) })}
              className="min-h-11 flex-1"
            />
          </div>

          {/* 월 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-muted-foreground">월</Label>
            <Select disabled={uploading} value={String(form.exam_month)} onValueChange={(v) => setForm({ ...form, exam_month: Number(v) })}>
              <SelectTrigger aria-label="월" className="min-h-11 flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m) => <SelectItem key={m} value={String(m)}>{m}월</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 학년 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-muted-foreground">학년</Label>
            <Select disabled={uploading} value={String(form.grade)} onValueChange={(v) => setForm({ ...form, grade: Number(v) })}>
              <SelectTrigger aria-label="학년" className="min-h-11 flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3].map((g) => <SelectItem key={g} value={String(g)}>고{g}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 구분 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-muted-foreground">구분</Label>
            <Select
              disabled={uploading}
              value={form.source}
              onValueChange={(v) => setForm({
                ...form,
                source: v,
                exam_month: v === '수능' ? 11 : form.exam_month,
                grade: v === '수능' ? 3 : form.grade,
              })}
            >
              <SelectTrigger aria-label="구분" className="min-h-11 flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="수능">수능</SelectItem>
                <SelectItem value="모의고사">모의고사</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 시험지 유형 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-muted-foreground">유형</Label>
            <Select disabled={uploading} value={form.form_type} onValueChange={(v) => setForm({ ...form, form_type: v })}>
              <SelectTrigger aria-label="유형" className="min-h-11 flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="홀수형">홀수형</SelectItem>
                <SelectItem value="짝수형">짝수형</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 제목 미리보기 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-muted-foreground">제목</Label>
            <div className="flex-1 rounded-md bg-muted px-3 py-2 text-sm text-foreground">{autoTitle}</div>
          </div>

          {/* PDF */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-muted-foreground">파일</Label>
            <FileUpload className="min-h-11 flex-1" label="시험지 파일 선택" description="PDF 또는 이미지" accept=".pdf,image/*" inputRef={fileRef} disabled={uploading} fileName={fileName} onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')} />
          </div>

          {/* 해설 PDF — 선택. 지금 없으면 나중에 시험 카드의 해설 버튼으로 붙일 수 있다 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-muted-foreground">해설</Label>
            <FileUpload className="min-h-11 flex-1" label="해설 PDF 선택" description="PDF · 선택 사항" accept=".pdf" inputRef={explanationRef} disabled={uploading} fileName={explanationName} onChange={(e) => setExplanationName(e.target.files?.[0]?.name ?? '')} />
          </div>
          <p className="pl-[76px] text-xs text-muted-foreground">
            해설을 같이 올리면 문항 추출 후 이어서 해설·AI 풀이·어휘까지 처리합니다. 나중에 붙여도 됩니다.
          </p>

          {uploading && <UploadProgress elapsed={elapsed} explaining={explaining} message={workerMessage} />}

          <Button variant="action" className="min-h-11 w-full" onClick={handleUpload} disabled={uploading}>
            {uploading ? (
              <>
                <FileText className="mr-2 h-4 w-4 animate-spin" />
                {explaining ? '해설 처리 중' : '업로드·접수 중'}... ({elapsed}초)
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                기출 등록 시작
              </>
            )}
          </Button>
        </fieldset>
  )
  if (inline) return <section aria-label="기출 PDF 등록" className="space-y-4 rounded-xl border bg-card p-4 sm:p-5"><h2 className="font-semibold">기출 PDF 등록</h2>{content}</section>
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>기출문제 등록</DialogTitle></DialogHeader>{content}</DialogContent></Dialog>
}

// ── 업로드 진행 표시 ──────────────────────────────────────────────────────

function UploadProgress({ elapsed, explaining, message }: { elapsed: number; explaining: boolean; message?: string }) {
  return <div role="status" className="space-y-2 rounded-lg bg-muted p-4 text-sm">
    <p className="font-medium">{message || (explaining ? '해설·풀이·어휘 처리 결과를 기다리는 중입니다.' : '파일 업로드 및 등록 요청을 처리 중입니다.')}</p>
    <p className="text-xs text-muted-foreground">경과 {elapsed}초 · 접수가 완료되면 등록·처리 내역에서 진행 상황을 확인할 수 있습니다.</p>
  </div>
}
