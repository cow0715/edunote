'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { BookDocument, BookDraftUnit, BookManifest, BookQuestionRef, BookValidation, BookVerification } from '@/lib/book-pdf/types'
import { BookClassificationDialog } from './book-classification'
import { MarkdownText } from './markdown'
import { BookProcessingSummary } from './book-processing-summary'
import { usePdfImportJobs } from '@/components/pdf-import/use-jobs'
import { PdfImportJobList } from '@/components/pdf-import/job-list'
import { PilotReview } from '@/components/pdf-import/pilot-review'
import { bookPilotAwaitingApproval, bookReconciledRegistration } from '@/lib/book-pdf/pilot-review'

type Summary = { unit_key: string; version: number; verified_version: number | null; verification: BookVerification; validation: BookValidation; pages: number[]; questions: BookQuestionRef[]; has_extraction: boolean }
type Overview = { document: Omit<BookDocument, 'manifest'> & { manifest: (Omit<BookManifest, 'units'> & { unit_count: number; classification_error?: string }) | null }; units: Summary[] }
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init }), data = await response.json()
  if (!response.ok) throw new Error(data.error || '요청 처리 실패')
  return data as T
}
const statusText = { processing: '추출·자동 검증 중', review: '자동 등록 보류', published: '자동 등록 완료' }

export function BookResult({ id }: { id: string }) {
  const [editing, setEditing] = useState(false)
  const [unit, setUnit] = useState<string | null>(null)
  const jobs = usePdfImportJobs()
  const overview = useQuery<Overview>({ queryKey: ['book-pdf', id], queryFn: () => api(`/api/book-pdf/${id}`), refetchInterval: (q) => q.state.data?.document.status === 'processing' ? 5_000 : false })
  const detail = useQuery<BookDraftUnit>({ queryKey: ['book-pdf-unit', id, unit], queryFn: () => api(`/api/book-pdf/${id}/units/${encodeURIComponent(unit!)}`), enabled: !!unit, staleTime: 0 })
  if (overview.error) return <p role="alert" className="text-destructive">{overview.error.message}</p>
  if (!overview.data) return <p>처리 결과를 불러오는 중…</p>
  const { document: doc, units } = overview.data, manifest = doc.manifest
  const job = jobs.data?.find((j) => j.kind === 'bank_book' && j.target_id === id)
  const registration = bookReconciledRegistration(job)
  const reconciled = !!registration && registration.bankId === doc.exam_bank_id && registration.count === manifest?.question_count
  const pilotWaiting = !!job && bookPilotAwaitingApproval(job) && !reconciled
  const displayStatus = doc.status === 'processing' && job?.status === 'failed' && !pilotWaiting ? 'review' : doc.status
  const passed = units.filter((u) => u.verification?.status === 'passed' && u.verified_version === u.version && !u.validation.errors.length).length
  const unresolved = units.filter((u) => u.verification?.status === 'unresolved')
  const headline = reconciled || doc.status === 'published' ? '등록 완료' : pilotWaiting ? '전체 처리 승인 대기' : displayStatus === 'review' ? '등록 보류' : '처리 중'
  const inventoryErrors = Array.isArray(job?.result?.inventory_errors) ? job.result.inventory_errors.filter((e): e is string => typeof e === 'string') : []
  const documentIssues = reconciled ? [] : [...new Set([manifest?.classification_error, ...(manifest?.errors ?? []), ...inventoryErrors])]
    .filter((issue): issue is string => !!issue)
  function row(u: Summary) { return <button key={u.unit_key} onClick={() => setUnit(u.unit_key)} className="flex w-full flex-wrap justify-between gap-2 p-3 text-left hover:bg-[var(--control-bg)]">
    <span className="text-sm">{u.questions.map((q) => q.label).join(' / ')} <span className="text-muted-foreground">p.{u.pages.join(', ')}</span></span>
    <span className={`text-xs ${u.verification?.status === 'unresolved' ? 'text-destructive' : 'text-muted-foreground'}`}>{u.verification?.status === 'passed' && u.verified_version === u.version ? '자동 검증 통과' : u.verification?.status === 'unresolved' ? `자동 복구 ${u.verification.attempts}회 · 미통과` : '처리 대기'}</span>
  </button> }
  return <section className="space-y-4" aria-label="교재 자동 검증 결과">
    <div className="space-y-2"><span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${headline === '등록 보류' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-foreground'}`}>{headline}</span><h2 className="break-words text-lg font-semibold">{doc.title}</h2></div>
    <BookClassificationDialog document={editing ? doc : null} onClose={() => setEditing(false)} />
    {documentIssues.length > 0 && <ul aria-label="교재 등록 보류 사유" className="space-y-2 rounded-xl border border-destructive/20 p-3 text-sm text-destructive">{documentIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    {!documentIssues.length && !unresolved.length && !reconciled && job?.error && !pilotWaiting && doc.status !== 'published' && <p role="alert" className="text-sm text-destructive">{job.error}</p>}
    <BookProcessingSummary key={id} documentId={id} bankId={doc.exam_bank_id} total={manifest?.question_count ?? null} status={displayStatus} pending={unresolved.flatMap(u => u.questions.map(q => ({ key: q.key, label: q.label,
      page: q.label_page || u.pages[0] || 1, reason: [...new Set([...(u.verification.issues ?? []), ...u.validation.errors])].join(' · ') || '이 문항을 검증하지 못했습니다.' })))} />
    {displayStatus === 'review' && !reconciled && unresolved.length > 0 && !doc.exam_bank_id && <p className="text-sm text-muted-foreground">교재는 모든 문항의 검증을 통과한 뒤 문제은행에 등록됩니다.</p>}
    {pilotWaiting && job && <PilotReview jobId={job.id} />}
    {!pilotWaiting && job && (job.can_retry || job.can_resume_failed) && <details className="rounded-lg border"><summary className="min-h-11 cursor-pointer p-3 text-sm">재처리 옵션</summary><PdfImportJobList jobId={job.id} /></details>}
    <details className="rounded-lg border"><summary className="min-h-11 cursor-pointer p-3 text-sm">전체 처리 내역 {units.length}묶음</summary>
      <div className="space-y-2 border-t p-3 text-xs text-muted-foreground">
        <p>{reconciled ? '이전 자동 처리 기록' : '자동 처리 기록'} · {statusText[displayStatus]}{manifest && ` · ${passed}/${manifest.unit_count}묶음 자동 검증 통과`}</p>
        {manifest && <><p>등록 학년도 {doc.academic_year ?? '미상'} · PDF 학년도 {manifest.printed_years.join(', ') || '미확인'} · 파일명 연도 {manifest.filename_year ?? '미상'}</p>{manifest.warnings.map(w => <p key={w}>{w}</p>)}</>}
        <Button variant="ghost" className="min-h-11" disabled={doc.status === 'processing'} onClick={() => setEditing(true)}>분류 수정</Button>
      </div><div className="divide-y border-t">{units.map(row)}</div>
    </details>
    <Dialog open={!!unit} onOpenChange={(open) => { if (!open) setUnit(null) }}><DialogContent className="flex max-h-[95dvh] flex-col overflow-hidden shadow-none sm:max-w-[96vw]">
      <DialogHeader><DialogTitle>원본 및 자동 처리 결과</DialogTitle><DialogDescription>자동 대조 결과와 미통과 사유입니다. 사람이 확인해야 등록되는 절차는 없습니다.</DialogDescription></DialogHeader>
      {detail.error ? <p role="alert" className="text-destructive">{detail.error.message}</p> : detail.data && detail.data.unit_key === unit ? <UnitResult id={id} unit={detail.data} /> : <p>불러오는 중…</p>}
    </DialogContent></Dialog>
  </section>
}

function Text({ label, value }: {label: string; value: string}) { return <div className="space-y-1"><h3 className="text-sm font-medium">{label}</h3><div className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm leading-relaxed"><MarkdownText text={value || '추출 결과 없음'} /></div></div> }
function UnitResult({ id, unit }: {id: string; unit: BookDraftUnit}) {
  const source = `/api/book-pdf/${id}/source?page=${unit.manifest.pages[0]}`, ex = unit.extraction
  const correction = unit.verification?.printed_choice_correction
  return <div className="grid min-h-0 flex-1 gap-4 overflow-auto lg:grid-cols-2">
    <div className="space-y-2 lg:sticky lg:top-0 lg:self-start"><a href={source} target="_blank" rel="noreferrer" className="text-sm text-blue-600 underline">원본 PDF 새 창에서 보기</a><iframe title="교재 원본 PDF" src={source} className="h-[60dvh] w-full rounded-lg border" /></div>
    <div className="space-y-4">
      <div className="space-y-1 rounded-lg border p-3 text-sm" aria-live="polite"><p>자동 대조 {unit.verification?.attempts ?? 0}회</p>{[...new Set([...(unit.verification?.issues ?? []), ...unit.validation.errors])].map(e => <p key={e} className="text-destructive">{e}</p>)}
        {correction && <p>{correction.field === 'passage' ? '지문 속 번호' : '선지 번호'} 교정 {correction.from} → {correction.to} · PDF {correction.page}쪽</p>}</div>
      {ex && <><Text label="공유 지문" value={ex.passage} /><Text label="원문 해석" value={ex.translation} />{ex.questions.map((q) => {
        const supplement = unit.verification?.protocol === 2 ? unit.enrichment?.questions.find((s) => s.key === q.key) : null
        return <div key={q.key} className="space-y-3 rounded-lg border p-3"><h3 className="font-semibold">{unit.manifest.questions.find((r) => r.key === q.key)?.label}</h3><Text label="발문" value={q.stem} /><Text label="선지" value={q.choices.join('\n')} /><p className="text-sm">정답: {q.answer}</p><Text label="원문 해설" value={q.solution} />{supplement && <><Text label="AI 보완 풀이" value={supplement.solution} />{supplement.vocabulary && <Text label="AI 보완 어휘" value={supplement.vocabulary} />}</>}</div>
      })}<Text label="원문 어휘" value={ex.vocabulary} /></>}
    </div>
  </div>
}
