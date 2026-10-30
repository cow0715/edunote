'use client'
import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileUpload } from '@/components/ui/file-upload'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { examPdfUploadPath } from '@/lib/pdf-import/client'
import { BOOK_CATALOG, bookVolumes, VOLUME_LABELS, validBookVolume, type BookCode, type BookVolume } from '@/lib/book-pdf/catalog'
import { bookFileIssue, bookSelectionIssue, inferBookSelection, type BookSelection } from '@/lib/book-pdf/registration-selection'
type Row = { file: File; pages: number; selection: BookSelection }
type BundleFile = { document_id: string; title: string; phase: string; reason: string | null; job_id: string | null; status: string; error: string | null; spent_usd: number; reserved_usd: number; unit_count?: number; question_count?: number; done_units?: number }
export type BookBundle = { id: string; state: string; limit_usd: number; stop_reason?: string | null; files: BundleFile[] }
const DRAFT = 'edunote-book-bundle-pending'
export function useBookBundles() {
  return useQuery<{ bundles: BookBundle[] }>({ queryKey: ['book-bundles'], queryFn: async () => {
    const response = await fetch('/api/book-pdf/bundles', { cache: 'no-store' }), data = await response.json()
    if (!response.ok) throw Error(data.error || '묶음 처리 내역 조회 실패')
    return data
  }, retry: false, refetchInterval: q => q.state.data?.bundles?.some(b => b.state === 'preparing' || b.files.some(f => ['queued','running','waiting_batch'].includes(f.status))) ? 15_000 : false })
}
export function BookBundleUpload({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<Row[]>([]), [year, setYear] = useState(new Date().getFullYear()+1)
  const [checking, setChecking] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [locked, setLocked] = useState(false)
  const generation = useRef(0), submitting = useRef(false), paths = useRef(new Map<File, string>()), requestKey = useRef<string | null>(null), client = useQueryClient()
  const issue = rows.map(row => bookSelectionIssue(row.selection, row.file.name)).find(Boolean)
  async function choose(files: File[]) {
    const turn = ++generation.current; setError(''); setMessage(''); setRows([]); paths.current.clear(); requestKey.current = null
    if (!files.length || files.length>4) { setError('한 번에 PDF 1~4개를 선택해주세요.'); return }
    setChecking(true)
    try {
      const next: Row[] = [], { PDFDocument } = await import('pdf-lib')
      for (const file of files) {
        const issue = bookFileIssue(file); if (issue) throw Error(`${file.name}: ${issue}`)
        const count = (await PDFDocument.load(await file.arrayBuffer())).getPageCount()
        if (count>600) throw Error(`${file.name}: 600페이지 이하의 PDF를 선택해주세요.`)
        const selection = inferBookSelection({ bookCode: '', volume: 'full', academicYear: year }, file.name)
        if (selection.bookCode === 'suteuk_english') throw Error('수능특강 영어는 기존 한 파일 등록을 이용해주세요. 묶음은 확인한 영독·수완 서식에 적용합니다.')
        next.push({ file, pages: count, selection })
      }
      if (turn === generation.current) setRows(next)
    } catch (e) { if (turn === generation.current) setError(e instanceof Error ? e.message : 'PDF 확인 실패') }
    finally { if (turn === generation.current) setChecking(false) }
  }
  async function send(payload: unknown) {
    const response = await fetch('/api/book-pdf/bundles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await response.json(); if (!response.ok) throw Error(data.error || '묶음 접수 실패')
    sessionStorage.removeItem(DRAFT)
    setMessage('묶음을 접수했습니다. 기존 응답·보류 작업은 보존하며 파일별 진행 상황은 아래 내역에서 확인할 수 있습니다.')
    await Promise.all(['book-bundles','book-pdf','pdf-import-jobs'].map(key => client.invalidateQueries({ queryKey: [key] })))
  }
  async function upload(resume = false) {
    if (submitting.current) return; submitting.current = true; setBusy(true); setError('')
    try {
      if (resume) {
        const saved = sessionStorage.getItem(DRAFT); if (!saved) throw Error('이 브라우저에 이어 접수할 기록이 없습니다.')
        await send(JSON.parse(saved)); return
      }
      if (!rows.length || issue) throw Error(issue || 'PDF를 선택해주세요.')
      const supabase = createClient(), files = []
      for (const row of rows) {
        let path = paths.current.get(row.file)
        if (!path) {
          path = await examPdfUploadPath(supabase, row.file.name)
          const result = await supabase.storage.from('exam-pdf-temp').upload(path, row.file, { contentType: 'application/pdf' })
          if (result.error) throw Error(result.error.message)
          paths.current.set(row.file, path)
        }
        files.push({ ...row.selection, fileName: row.file.name, storagePath: path })
      }
      requestKey.current ??= crypto.randomUUID()
      const payload = { requestKey: requestKey.current, files }
      sessionStorage.setItem(DRAFT, JSON.stringify(payload)); setLocked(true); await send(payload)
    } catch (e) { setError(e instanceof Error ? e.message : '묶음 접수 실패') }
    finally { submitting.current = false; setBusy(false) }
  }
  return <section className="space-y-4" aria-label="교재 묶음 등록">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">영독·수완 함께 등록</p><Button variant="ghost" className="min-h-11" disabled={busy} onClick={onBack}>한 파일 등록으로</Button></div>
    <FileUpload label="교재 PDF 여러 개 선택" description="최대 4개 · 파일별 50MB·600페이지 이하" accept="application/pdf,.pdf" multiple compact loading={checking} disabled={busy || locked} onChange={e => void choose(Array.from(e.target.files ?? []))} fileName={rows.length ? `${rows.length}개 PDF 선택됨` : undefined} />
    <label className="block space-y-2 text-sm"><span>공통 학년도 · 표지 기준</span><input type="number" min={1900} max={2200} value={year} disabled={busy || checking || locked} className="h-11 w-36 rounded-lg border bg-background px-3" onChange={e => { const next = Number(e.target.value); setYear(next); requestKey.current = null; setRows(previous => previous.map(row => ({ ...row, selection: { ...row.selection, academicYear: next } }))) }} /></label>
    {rows.map((row, index) => <fieldset key={`${row.file.name}-${index}`} disabled={busy || locked} className="min-w-0 space-y-2 border-t pt-3"><legend className="max-w-full break-words pt-3 text-sm font-medium">{row.file.name}</legend><p className="text-xs text-muted-foreground">{row.pages}페이지</p><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm"><span>교재</span><select className="h-11 w-full rounded-lg border bg-background px-3" value={row.selection.bookCode} onChange={e => { const code = e.target.value as BookCode; requestKey.current = null; setRows(old => old.map((r,i) => i!==index?r:{...r,selection:{...r.selection,bookCode:code,volume:validBookVolume(code,r.selection.volume)?r.selection.volume:'full'}})) }}><option value="">교재 선택</option>{BOOK_CATALOG.filter(b => b.code!=='suteuk_english').map(b => <option key={b.code} value={b.code}>{b.label}</option>)}</select></label>
      <label className="space-y-1 text-sm"><span>분권</span><select className="h-11 w-full rounded-lg border bg-background px-3" value={row.selection.volume} onChange={e => { requestKey.current = null; setRows(old => old.map((r,i) => i!==index?r:{...r,selection:{...r.selection,volume:e.target.value as BookVolume}})) }}>{bookVolumes(row.selection.bookCode).map(v => <option key={v} value={v}>{VOLUME_LABELS[v]}</option>)}</select></label>
    </div></fieldset>)}
    <p className="text-xs leading-relaxed text-muted-foreground">파일당 최대 $5 · 묶음 최대 ${rows.length*5 || 20}. 기존 사용액·접수 예약액을 포함합니다. 전체 구조 검사 후 파일별 최대 $0.50의 대표 구간을 검증하고, 통과한 파일만 확대합니다.</p>
    {(error || issue) && <p role="alert" className="text-sm text-destructive">{error || issue}</p>}{message && <p role="status" className="text-sm">{message}</p>}
    <div className="flex flex-wrap gap-2"><Button variant="action" className="min-h-11" disabled={busy || checking || !rows.length || !!issue || !!message || year<1900 || year>2200} onClick={() => void upload()}>{busy?'묶음 접수 중…':'교재 묶음 등록 시작'}</Button><Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => void upload(true)}>이전 접수 이어 확인</Button></div>
  </section>
}
export function BookBundleHistory({ bundles, onOpenBook }: { bundles: BookBundle[]; onOpenBook: (id: string) => void }) {
  return <div className="space-y-5">{bundles.map(bundle => <section key={bundle.id} aria-label="교재 묶음 처리" className="space-y-3 border-b pb-4">
    <div className="flex flex-wrap justify-between gap-2 text-sm"><p className="font-medium">교재 {bundle.files.length}개 묶음 · {bundle.state==='ready'?'접수됨':'접수 준비 중'}</p><p>사용 ${bundle.files.reduce((n,f)=>n+Number(f.spent_usd),0).toFixed(2)} · 예약 ${bundle.files.reduce((n,f)=>n+Number(f.reserved_usd),0).toFixed(2)} / 상한 ${Number(bundle.limit_usd).toFixed(2)}</p></div>
    {bundle.stop_reason && <p role="alert" className="text-sm text-destructive">{bundle.stop_reason}</p>}
    {bundle.files.map(file => <div key={file.document_id} className="space-y-1 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p>{file.title}</p><Button variant="ghost" className="min-h-11" onClick={() => onOpenBook(file.document_id)}>처리 상세</Button></div><p className="text-xs text-muted-foreground">{file.status==='published'?'등록 완료':file.status==='failed'||file.phase==='held'?'등록 보류':file.status==='waiting_batch'?'응답·처리 순서 대기':file.phase==='pilot'?'전체 구조·대표 구간 확인':'원본 대조·풀이·어휘 보완'} · 사용 ${Number(file.spent_usd).toFixed(2)} · 예약 ${Number(file.reserved_usd).toFixed(2)} / $5</p>{(file.error||file.reason) && <p className="text-xs text-destructive">{file.error||file.reason}</p>}</div>)}
    {bundle.files.some(f=>f.unit_count) && <p className="text-xs text-muted-foreground">검증·보완 완료 {bundle.files.reduce((n,f)=>n+(f.done_units??0),0)}/{bundle.files.reduce((n,f)=>n+(f.unit_count??0),0)}지문 · {bundle.files.reduce((n,f)=>n+(f.question_count??0),0)}문항</p>}
  </section>)}</div>
}
