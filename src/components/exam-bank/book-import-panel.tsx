'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import { examPdfUploadPath } from '@/lib/pdf-import/client'
import type { BookDocument, BookDraftUnit, BookManifest, BookQuestionRef, BookValidation, BookVerification } from '@/lib/book-pdf/types'
import { PdfImportJobList } from '@/components/pdf-import/job-list'
import { MarkdownText } from './markdown'

type Summary = { unit_key: string; version: number; verified_version: number | null; verification: BookVerification; validation: BookValidation; pages: number[]; questions: BookQuestionRef[]; has_extraction: boolean }
type Overview = { document: Omit<BookDocument, 'manifest'> & { manifest: (Omit<BookManifest, 'units'> & { unit_count: number }) | null }; units: Summary[] }
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init }), data = await response.json()
  if (!response.ok) throw new Error(data.error || '요청 처리 실패')
  return data as T
}
const statusText = { processing: '추출·자동 검증 중', review: '자동 등록 보류', published: '자동 등록 완료' }

export function BookImportPanel() {
  const [file, setFile] = useState<File | null>(null), [title, setTitle] = useState(''), [selected, setSelected] = useState<string | null>(null), [uploading, setUploading] = useState(false)
  const list = useQuery<{ enabled: boolean; documents: BookDocument[] }>({ queryKey: ['book-pdf'], queryFn: () => api('/api/book-pdf'), refetchInterval: 10_000 })
  async function upload() {
    if (!file || !title.trim()) return
    setUploading(true)
    try {
      const supabase = createClient(), path = await examPdfUploadPath(supabase, file.name)
      const stored = await supabase.storage.from('exam-pdf-temp').upload(path, file, { contentType: 'application/pdf' })
      if (stored.error) throw new Error(stored.error.message)
      const result = await api<{document_id: string}>('/api/book-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim(), fileName: file.name, storagePath: path }) })
      setSelected(result.document_id)
      await list.refetch()
      toast.success('추출·검증·자동 등록을 시작했습니다. 창을 닫아도 계속 처리합니다.')
    } catch (error) { toast.error(error instanceof Error ? error.message : '업로드 실패') }
    finally { setUploading(false) }
  }
  return <div className="space-y-4">
    <div className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">교재 PDF 등록</h2>
      <p className="text-sm text-gray-600">원문 구조화 → 원본 대조·오류 복구 → 풀이·어휘 보완 → 전체 통과 시 문제은행·단어장 자동 등록 순서로 처리합니다.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">자료명<Input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} placeholder="예: 수능특강 영어 상" /></label>
        <label className="space-y-1 text-sm">원본 PDF<Input type="file" accept="application/pdf,.pdf" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !title) setTitle(f.name.replace(/\.pdf$/i, '')) }} /></label>
      </div>
      <Button disabled={!list.data?.enabled || uploading || !file || !title.trim()} onClick={() => void upload()}>{uploading ? '업로드 중…' : '자동 등록 시작'}</Button>
      {list.error && <p role="alert" className="text-sm text-red-600">{list.error.message}</p>}
      {list.data && !list.data.enabled && <p className="text-sm text-gray-600">교재 워커와 DB 설정 후 사용할 수 있습니다.</p>}
    </div>
    <PdfImportJobList />
    <div className="flex flex-wrap gap-2" aria-label="교재 목록">{list.data?.documents.map((d) => <Button key={d.id} variant={selected === d.id ? 'default' : 'outline'} className="h-auto whitespace-normal text-left" onClick={() => setSelected(d.id)}>{d.title} · {statusText[d.status]}</Button>)}</div>
    {selected && <BookResult key={selected} id={selected} />}
  </div>
}

function BookResult({ id }: { id: string }) {
  const [unit, setUnit] = useState<string | null>(null)
  const overview = useQuery<Overview>({ queryKey: ['book-pdf', id], queryFn: () => api(`/api/book-pdf/${id}`), refetchInterval: (q) => q.state.data?.document.status === 'processing' ? 5_000 : false })
  const detail = useQuery<BookDraftUnit>({ queryKey: ['book-pdf-unit', id, unit], queryFn: () => api(`/api/book-pdf/${id}/units/${encodeURIComponent(unit!)}`), enabled: !!unit, staleTime: 0 })
  if (overview.error) return <p role="alert" className="text-red-600">{overview.error.message}</p>
  if (!overview.data) return <p>처리 결과를 불러오는 중…</p>
  const { document: doc, units } = overview.data, manifest = doc.manifest
  const passed = units.filter((u) => u.verification?.status === 'passed' && u.verified_version === u.version && !u.validation.errors.length).length
  const unresolved = units.filter((u) => u.verification?.status === 'unresolved')
  function row(u: Summary) { return <button key={u.unit_key} onClick={() => setUnit(u.unit_key)} className="flex w-full flex-wrap justify-between gap-2 p-3 text-left hover:bg-[var(--control-bg)]">
    <span className="text-sm">{u.questions.map((q) => q.label).join(' / ')} <span className="text-gray-500">p.{u.pages.join(', ')}</span></span>
    <span className={`text-xs ${u.verification?.status === 'unresolved' ? 'text-red-600' : 'text-gray-600'}`}>{u.verification?.status === 'passed' && u.verified_version === u.version ? '자동 검증 통과' : u.verification?.status === 'unresolved' ? `자동 복구 ${u.verification.attempts}회 · 미통과` : '처리 대기'}</span>
  </button> }
  return <section className="space-y-4 rounded-xl border bg-white p-4" aria-label="교재 자동 검증 결과">
    <h2 className="font-semibold">{doc.title}</h2>
    <p className="text-sm text-gray-600">{statusText[doc.status]}{manifest && ` · ${manifest.question_count}문항 · ${passed}/${manifest.unit_count}묶음 자동 검증 통과`}</p>
    <p className="text-sm text-gray-600">문항별 확인이나 재요청 없이 원문·정답·문항 연결·서식을 대조하고 오류를 복구합니다. 검증된 원문으로 풀이·어휘를 보완하며, 확정하지 못한 자료는 등록하지 않습니다.</p>
    {manifest && <div className="space-y-1 text-sm">
      <p>인쇄 학년도: {doc.academic_year ?? '미상'} · 파일명 연도: {manifest.filename_year ?? '미상'}</p>
      {manifest.errors.map((e) => <p key={e} role="alert" className="text-red-600">{e}</p>)}
      {manifest.warnings.map((w) => <p key={w} className="text-gray-600">{w}</p>)}
    </div>}
    {doc.status === 'review' && <p className="text-sm text-red-600">{manifest?.errors.length ? '원문 문항 경계를 확정할 수 없어 등록을 보류했습니다.' : '자동 복구 후에도 확정되지 않은 묶음이 있어 등록을 보류했습니다. 미통과 사유를 남겼습니다.'}</p>}
    {unresolved.length > 0 && <div className="space-y-2"><h3 className="text-sm font-medium">자동 복구 미해결 {unresolved.length}묶음</h3><div className="divide-y rounded-lg border">{unresolved.map(row)}</div></div>}
    <details className="rounded-lg border"><summary className="cursor-pointer p-3 text-sm">전체 처리 내역 {units.length}묶음</summary><div className="divide-y border-t">{units.map(row)}</div></details>
    <Dialog open={!!unit} onOpenChange={(open) => { if (!open) setUnit(null) }}><DialogContent className="flex max-h-[95dvh] flex-col overflow-hidden shadow-none sm:max-w-[96vw]">
      <DialogHeader><DialogTitle>원본 및 자동 처리 결과</DialogTitle><DialogDescription>자동 대조 결과와 미통과 사유입니다. 사람이 확인해야 등록되는 절차는 없습니다.</DialogDescription></DialogHeader>
      {detail.error ? <p role="alert" className="text-red-600">{detail.error.message}</p> : detail.data && detail.data.unit_key === unit ? <UnitResult id={id} unit={detail.data} /> : <p>불러오는 중…</p>}
    </DialogContent></Dialog>
  </section>
}

function Text({ label, value }: {label: string; value: string}) { return <div className="space-y-1"><h3 className="text-sm font-medium">{label}</h3><div className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm leading-relaxed"><MarkdownText text={value || '추출 결과 없음'} /></div></div> }
function UnitResult({ id, unit }: {id: string; unit: BookDraftUnit}) {
  const source = `/api/book-pdf/${id}/source?page=${unit.manifest.pages[0]}`, ex = unit.extraction
  return <div className="grid min-h-0 flex-1 gap-4 overflow-auto lg:grid-cols-2">
    <div className="space-y-2 lg:sticky lg:top-0 lg:self-start"><a href={source} target="_blank" rel="noreferrer" className="text-sm text-blue-600 underline">원본 PDF 새 창에서 보기</a><iframe title="교재 원본 PDF" src={source} className="h-[60dvh] w-full rounded-lg border" /></div>
    <div className="space-y-4">
      <div className="space-y-1 rounded-lg border p-3 text-sm" aria-live="polite"><p>자동 대조 {unit.verification?.attempts ?? 0}회</p>{[...(unit.verification?.issues ?? []), ...unit.validation.errors].map((e, i) => <p key={i} className="text-red-600">{e}</p>)}{unit.verification?.status === 'passed' && <p>원본·추출 결과의 해시와 검증 버전을 함께 보관했습니다.</p>}</div>
      {ex && <><Text label="공유 지문" value={ex.passage} /><Text label="원문 해석" value={ex.translation} />{ex.questions.map((q) => {
        const supplement = unit.verification?.protocol === 2 ? unit.enrichment?.questions.find((s) => s.key === q.key) : null
        return <div key={q.key} className="space-y-3 rounded-lg border p-3"><h3 className="font-semibold">{unit.manifest.questions.find((r) => r.key === q.key)?.label}</h3><Text label="발문" value={q.stem} /><Text label="선지" value={q.choices.join('\n')} /><p className="text-sm">정답: {q.answer}</p><Text label="원문 해설" value={q.solution} />{supplement && <><Text label="AI 보완 풀이" value={supplement.solution} />{supplement.vocabulary && <Text label="AI 보완 어휘" value={supplement.vocabulary} />}</>}</div>
      })}<Text label="원문 어휘" value={ex.vocabulary} /></>}
    </div>
  </div>
}
