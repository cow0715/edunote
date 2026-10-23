'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FileUpload } from '@/components/ui/file-upload'
import { Button } from '@/components/ui/button'
import { resolvePdfImport } from '@/lib/pdf-import/client'
import { PdfImportJobList } from '@/components/pdf-import/job-list'
import { AnswerReviewPanel } from './answer-review-panel'
import type { AnswerDraft, ReviewAction } from '@/lib/week-answer-review'

interface Props { weekId: string; savedFilePath?: string | null; readingTotal?: number }

async function upload(file: File, weekId: string) {
  const response = await fetch(`/api/weeks/${weekId}/import-upload-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: file.name }) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '업로드 URL 생성 실패')
  const stored = await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file })
  if (!stored.ok) throw new Error('원본 파일 저장에 실패했습니다. 다시 시도해 주세요.')
  return { storagePath: data.path, mimeType: 'application/pdf', fileName: file.name }
}

export function AnswerSheetUploader(props: Props) {
  return <AnswerSheetUploaderContent key={props.weekId} {...props} />
}

function AnswerSheetUploaderContent({ weekId, savedFilePath }: Props) {
  const [question, setQuestion] = useState<File | null>(null)
  const [explanation, setExplanation] = useState<File | null>(null)
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const qc = useQueryClient()
  const drafts = useQuery<AnswerDraft[]>({ queryKey: ['answer-review', weekId], queryFn: async () => {
    const response = await fetch(`/api/weeks/${weekId}/answer-review`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '검토 자료를 불러오지 못했습니다.')
    return data
  } })
  const draft = drafts.data?.find(d => d.id === selected) ?? drafts.data?.find(d => d.status === 'review') ?? drafts.data?.[0]
  function pick(file: File | undefined, set: (file: File | null) => void) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('PDF 파일을 선택해 주세요.'); return }
    set(file); setError('')
  }
  async function start() {
    if (!question) return
    setError(''); setStage('문제지·해설지 원본을 보관하는 중입니다.')
    try {
      const files = [await upload(question, weekId)]
      if (explanation) files.push(await upload(explanation, weekId))
      setStage('정답 근거와 검토 초안을 준비하는 중입니다.')
      const response = await fetch(`/api/weeks/${weekId}/parse-answers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) })
      let data = await response.json()
      if (!response.ok) throw new Error(data.error || '초안 생성 실패')
      data = await resolvePdfImport(data, job => setStage(job.stage))
      setSelected(String(data.draft_id))
      await qc.invalidateQueries({ queryKey: ['answer-review', weekId] })
      toast.success('검토 초안을 만들었습니다. 아직 정답과 채점 결과는 변경되지 않았습니다.')
    } catch (e) { setError(e instanceof Error ? e.message : '초안 생성 실패') }
    finally { setStage('') }
  }
  async function confirm(actions: ReviewAction[]) {
    if (!draft) return
    setSaving(true); setError('')
    try {
      const response = await fetch(`/api/weeks/${weekId}/answer-review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft_id: draft.id, actions }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '정답 확정 실패')
      await Promise.all(['answer-review', 'exam-questions', 'week', 'grade', 'pdf-import-jobs'].map(key => qc.invalidateQueries({ queryKey: [key, weekId] })))
      toast.success('검토한 정답을 확정했습니다. 기존 학생 답안은 보존했습니다.')
    } catch (e) { setError(e instanceof Error ? e.message : '정답 확정 실패') }
    finally { setSaving(false) }
  }
  return <div className="space-y-4">
    <div className="space-y-2">
      <h2 className="text-xl font-semibold">시험 자료와 정답 등록</h2>
      <ol aria-label="등록 순서" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground"><li>1. 자료 올리기</li><li>2. 정답 확인하기</li><li>3. 검토 완료</li></ol>
      <p className="text-sm text-muted-foreground">기존 정답·학생 답안·점수는 유지됩니다. 새 자료는 검토 후 확정해 주세요.</p>
    </div>
    <PdfImportJobList weekId={weekId} />
    <details open={!draft} className="rounded-[20px] border bg-card p-4">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">1. 자료 올리기{draft && <span className="ml-3 text-sm font-normal text-muted-foreground">새 자료를 올리려면 펼쳐 주세요</span>}</summary>
    <section className="space-y-4 pt-3" aria-label="시험 자료 가져오기">
      <div><p className="text-sm text-muted-foreground">문제지와 정답·해설지를 한 세트로 등록합니다. 검토 후 확정하기 전에는 채점에 반영되지 않습니다.</p></div>
      <div className="grid gap-3 md:grid-cols-2"><FileUpload label="문제지 또는 통합 PDF" description="문제와 해설이 합쳐져 있으면 이 파일만 선택하세요." accept="application/pdf" fileName={question?.name} disabled={!!stage} onClear={() => setQuestion(null)} onChange={event => pick(event.target.files?.[0], setQuestion)} />
      <FileUpload label="정답·해설지 PDF (선택)" description="별도 해설지가 있으면 함께 선택하세요." accept="application/pdf" fileName={explanation?.name} disabled={!!stage} onClear={() => setExplanation(null)} onChange={event => pick(event.target.files?.[0], setExplanation)} /></div>
      {stage && <p role="status" className="rounded-xl bg-muted p-3 text-sm">{stage} 접수된 작업은 처리 내역에서 확인할 수 있습니다.</p>}
      {savedFilePath && <a className="inline-block text-sm text-primary underline" href={`/api/answer-sheet-url?path=${encodeURIComponent(savedFilePath)}`} onClick={async event => {
        event.preventDefault()
        try { const r = await fetch(`/api/answer-sheet-url?path=${encodeURIComponent(savedFilePath)}`); const data = await r.json(); if (!r.ok) throw new Error('원본 링크를 열지 못했습니다.'); window.open(data.url, '_blank', 'noopener,noreferrer') } catch (e) { setError(e instanceof Error ? e.message : '원본 확인 실패') }
      }}>이전에 보관한 PDF 보기</a>}
      <Button disabled={!question || !!stage || drafts.isError} onClick={() => void start()}>{stage ? '초안 준비 중…' : '자료 분석하고 정답 확인하기'}</Button>
    </section></details>
    {(error || drafts.error) && <div role="alert" className="rounded-xl border border-destructive p-4 text-sm text-destructive">{error || drafts.error?.message}</div>}
    {drafts.isError && <Button variant="outline" onClick={() => void drafts.refetch()}>다시 불러오기</Button>}
    {!!drafts.data?.length && <label className="block space-y-1 text-sm"><span className="block">자료 등록 내역</span><select aria-label="자료 등록 내역" className="min-h-11 w-full rounded-md border bg-background px-2" value={draft?.id} onChange={event => setSelected(event.target.value)}>{drafts.data.map(d => <option key={d.id} value={d.id}>{new Date(d.created_at).toLocaleString('ko-KR')} · {d.status === 'confirmed' ? '확정 완료' : '검토 대기'}</option>)}</select></label>}
    {draft && <AnswerReviewPanel key={draft.id + draft.status} draft={draft} weekId={weekId} saving={saving} onConfirm={confirm} />}
  </div>
}
