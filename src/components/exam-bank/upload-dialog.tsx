'use client'

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
import { Upload, FileText, File, BookOpen } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { MONTHS, safeJson } from './constants'

// ── 업로드 다이얼로그 ─────────────────────────────────────────────────────
// 신규 등록은 문제지 + 해설지를 한 번에 받는다. 서버는 기존 두 라우트 그대로고
// (문항 INSERT / 해설 UPDATE 는 선후 의존이라 합칠 수 없다) 브라우저가 순차로 부른다.
// 각 콜이 독립적으로 maxDuration 300s 예산을 쓰므로 벽시계 여유도 두 배다.
// 해설을 나중에 붙이는 경로(시험 카드 📖 · 일괄 해설)는 그대로 남아 있다.
export function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const explanationRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [explanationName, setExplanationName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadStep, setUploadStep] = useState(0)
  // 해설 단계로 넘어가면 문제지 단계 문구 대신 해설 진행을 보여준다
  const [explaining, setExplaining] = useState(false)
  const [elapsed, setElapsed] = useState(0)
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
  const uploadExplanation = async (examId: string, file: File) => {
    const supabase = createClient()
    const safeFileName = file.name.replace(/[^\w.\-]/g, '_')
    const storagePath = `${Date.now()}_explanation_${safeFileName}`
    const { error: uploadErr } = await supabase.storage
      .from('exam-pdf-temp')
      .upload(storagePath, file, { contentType: file.type || 'application/pdf' })
    if (uploadErr) throw new Error(`해설 파일 업로드 실패: ${uploadErr.message}`)

    const { ok, data } = await safeJson(
      await fetch(`/api/exam-bank/${examId}/upload-explanation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath }),
      })
    )
    if (!ok) throw new Error((data.error as string) || '해설 파싱 실패')

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

    setUploadStep(1)
    setElapsed(0)

    const timer = setInterval(() => setElapsed((s) => s + 1), 1000)
    const step2 = setTimeout(() => setUploadStep(2), 4000)
    const step3 = setTimeout(() => setUploadStep(3), 30000)
    const step4 = setTimeout(() => setUploadStep(4), 120000)

    // 끝나면 타이머·단계 표시를 되돌린다 (기존 finally 와 동일)
    await runWithLoading((loading) => {
      setUploading(loading)
      if (loading) return
      clearInterval(timer)
      clearTimeout(step2)
      clearTimeout(step3)
      clearTimeout(step4)
      setUploadStep(0)
      setExplaining(false)
      setElapsed(0)
    }, async () => {
      // PDF를 Supabase Storage에 직접 업로드 (Vercel 4.5MB body 한도 우회)
      const supabase = createClient()
      const safeFileName = file.name.replace(/[^\w.\-]/g, '_')
      const storagePath = `${Date.now()}_${safeFileName}`
      const { error: uploadErr } = await supabase.storage
        .from('exam-pdf-temp')
        .upload(storagePath, file, { contentType: file.type || 'application/pdf' })
      if (uploadErr) throw new Error(`파일 업로드 실패: ${uploadErr.message}`)

      const res = await fetch('/api/exam-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          title: autoTitle,
          storagePath,
          mimeType: file.type || 'application/pdf',
        }),
      })


      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '업로드 실패')

      // 콘텐츠 필터에 걸린 페이지는 서버가 페이지 단위로 재파싱하며 건너뛴다. 몇 쪽인지 알려줘야 손으로 채울 수 있다.
      const skippedMsg = data.skipped_pages?.length ? ` · ${data.skipped_pages.join(', ')}쪽 건너뜀` : ''
      const statsMsg = data.stats_fetched > 0 ? ` · 메가스터디 통계 ${data.stats_fetched}문항` : ''
      toast.success(`${data.question_count}개 문항 추출 완료${statsMsg}${skippedMsg}`)

      // 2단계 — 해설지를 같이 골랐으면 이어서. 실패해도 1단계 결과는 유지한다.
      if (explanationFile) {
        clearTimeout(step2)
        clearTimeout(step3)
        clearTimeout(step4)
        setExplaining(true)
        await runOrReport(
          () => uploadExplanation(data.exam_id as string, explanationFile),
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>기출문제 등록</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* 년 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-gray-500">년</Label>
            <Input
              type="number"
              value={form.exam_year}
              onChange={(e) => setForm({ ...form, exam_year: Number(e.target.value) })}
              className="flex-1"
            />
          </div>

          {/* 월 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-gray-500">월</Label>
            <Select value={String(form.exam_month)} onValueChange={(v) => setForm({ ...form, exam_month: Number(v) })}>
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m) => <SelectItem key={m} value={String(m)}>{m}월</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 학년 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-gray-500">학년</Label>
            <Select value={String(form.grade)} onValueChange={(v) => setForm({ ...form, grade: Number(v) })}>
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3].map((g) => <SelectItem key={g} value={String(g)}>고{g}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 구분 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-gray-500">구분</Label>
            <Select
              value={form.source}
              onValueChange={(v) => setForm({
                ...form,
                source: v,
                exam_month: v === '수능' ? 11 : form.exam_month,
                grade: v === '수능' ? 3 : form.grade,
              })}
            >
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="수능">수능</SelectItem>
                <SelectItem value="모의고사">모의고사</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 시험지 유형 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-gray-500">유형</Label>
            <Select value={form.form_type} onValueChange={(v) => setForm({ ...form, form_type: v })}>
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="홀수형">홀수형</SelectItem>
                <SelectItem value="짝수형">짝수형</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 제목 미리보기 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-gray-500">제목</Label>
            <div className="flex-1 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">{autoTitle}</div>
          </div>

          {/* PDF */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-gray-500">파일</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,image/*"
              className="hidden"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex flex-1 items-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 hover:border-gray-400 hover:bg-gray-50 transition-colors"
            >
              <File className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="truncate">{fileName || 'PDF 또는 이미지 파일 선택'}</span>
            </button>
          </div>

          {/* 해설 PDF — 선택. 지금 없으면 나중에 시험 카드의 해설 버튼으로 붙일 수 있다 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-gray-500">해설</Label>
            <input
              ref={explanationRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => setExplanationName(e.target.files?.[0]?.name ?? '')}
            />
            <button
              type="button"
              onClick={() => explanationRef.current?.click()}
              className="flex flex-1 items-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 hover:border-amber-400 hover:bg-amber-50 transition-colors"
            >
              <BookOpen className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="truncate">{explanationName || '해설 PDF 선택 (선택사항)'}</span>
            </button>
          </div>
          <p className="pl-[76px] text-xs text-gray-400">
            해설을 같이 올리면 문항 추출 후 이어서 해설·AI 풀이·어휘까지 처리합니다. 나중에 붙여도 됩니다.
          </p>

          {uploading && <UploadProgress step={uploadStep} elapsed={elapsed} explaining={explaining} />}

          <Button className="w-full" onClick={handleUpload} disabled={uploading}>
            {uploading ? (
              <>
                <FileText className="mr-2 h-4 w-4 animate-spin" />
                {explaining ? '해설 처리 중' : '파싱 중'}... ({elapsed}초)
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                {explanationName ? '업로드 & 문제·해설 파싱' : '업로드 & 파싱'}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── 업로드 진행 표시 ──────────────────────────────────────────────────────

const UPLOAD_STEPS = [
  { label: 'PDF 전송 중...', sub: 'Claude에게 파일을 보내는 중입니다' },
  { label: 'Claude가 시험지를 읽는 중...', sub: '페이지 구조와 문항 범위를 파악하고 있습니다' },
  { label: '지문과 보기를 추출하는 중...', sub: '18~45번 문항을 하나씩 파싱하고 있습니다' },
  { label: '거의 다 됐습니다...', sub: 'JSON 구조로 변환 중입니다. 조금만 기다려주세요' },
]

const EXPLANATION_STEP = {
  label: '해설을 읽고 보완하는 중...',
  sub: '출제의도·해석은 원문 그대로, 풀이·어휘는 AI가 이어서 채웁니다',
}

function UploadProgress({ step, elapsed, explaining }: { step: number; elapsed: number; explaining: boolean }) {
  const current = explaining ? EXPLANATION_STEP : (UPLOAD_STEPS[step - 1] ?? UPLOAD_STEPS[0])
  // 실측 40~50초/단계 (2026-08-27 기록) — 해설까지면 두 단계라 기준을 늘려 잡는다
  const progress = Math.min((elapsed / (explaining ? 240 : 120)) * 100, 95)
  const tone = explaining
    ? { box: 'bg-amber-50', title: 'text-amber-900', text: 'text-amber-600', track: 'bg-amber-200', bar: 'bg-amber-500' }
    : { box: 'bg-blue-50', title: 'text-blue-900', text: 'text-blue-600', track: 'bg-blue-200', bar: 'bg-blue-500' }

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${tone.box}`}>
      <div className="flex items-center justify-between">
        <p className={`text-sm font-medium ${tone.title}`}>{current.label}</p>
        <span className={`text-xs ${tone.text}`}>{elapsed}초</span>
      </div>
      <p className={`text-xs ${tone.text}`}>{current.sub}</p>
      <div className={`h-1.5 w-full rounded-full ${tone.track}`}>
        <div
          className={`h-1.5 rounded-full transition-all duration-1000 ${tone.bar}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
