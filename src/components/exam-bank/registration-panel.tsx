'use client'
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BookUploadForm, useBookDocuments } from './book-upload-form'
import { BookResult } from './book-import-panel'
import { UploadDialog } from './upload-dialog'
import { BulkExplanationDialog } from './bulk-explanation-dialog'
import { PdfImportJobList } from '@/components/pdf-import/job-list'
import { BookBundleHistory, useBookBundles } from './book-bundle'
import { RECOVERED_BOOK } from './book-processing-summary'
import { isActiveImport, usePdfImportJobs } from '@/components/pdf-import/use-jobs'

export function RegistrationPanel({ documentId, materialId, showHistory, onOpenBook, onOpenMaterial }: {
  documentId: string | null; materialId?: string | null; showHistory?: boolean; onOpenBook: (id: string) => void; onOpenMaterial: (id: string) => void
}) {
  const [kind, setKind] = useState<'book' | 'exam'>('book'), [bulkOpen, setBulkOpen] = useState(false)
  const [opened, setOpened] = useState({ book: true, exam: false })
  const [view, setView] = useState<'register' | 'history' | 'detail' | null>(null)
  const [openedBook, setOpenedBook] = useState<string | null>(null)
  const bundles = useBookBundles().data?.bundles ?? []
  const jobs = usePdfImportJobs().data
  const books = useBookDocuments()
  const documents = books.data?.documents ?? []
  const linkedBook = documentId || (materialId ? documents.find((d) => d.exam_bank_id === materialId)?.id : null)
    || (materialId === RECOVERED_BOOK.bankId ? documents.find((d) => d.id === RECOVERED_BOOK.documentId)?.id : null)
  const selectedDocument = openedBook || linkedBook
  const active = jobs?.filter(isActiveImport).length ?? 0
  const currentView = view ?? (selectedDocument ? 'detail' : showHistory ? 'history' : 'register')
  function select(value: 'book' | 'exam') { setKind(value); setOpened((previous) => ({ ...previous, [value]: true })) }
  function openBook(id: string) { setOpenedBook(id); setView('detail'); onOpenBook(id) }
  return <div className="mx-auto w-full max-w-3xl space-y-5">
    <div className="flex gap-1 border-b" aria-label="등록·처리 보기">
      <Button variant="ghost" aria-pressed={currentView === 'register'} className="min-h-11 rounded-none border-b-2 border-transparent px-3 aria-pressed:border-foreground" onClick={() => setView('register')}>새 자료 등록</Button>
      <Button variant="ghost" aria-pressed={currentView !== 'register'} className="min-h-11 rounded-none border-b-2 border-transparent px-3 aria-pressed:border-foreground" onClick={() => setView('history')}>처리 현황{active > 0 ? ` ${active}` : ''}</Button>
    </div>
    {currentView === 'detail' && selectedDocument && <section aria-label="교재 등록 결과" className="space-y-3">
      <Button variant="ghost" className="min-h-11 px-2" onClick={() => setView('history')}><ArrowLeft className="size-4" aria-hidden="true" /> 처리 목록으로</Button>
      {books.error && <div role="alert"><p className="text-sm">{books.error.message}</p><Button variant="outline" onClick={() => void books.refetch()}>교재 목록 다시 불러오기</Button></div>}
      <BookResult key={selectedDocument} id={selectedDocument} />
    </section>}
    <section hidden={currentView !== 'register'} className="min-w-0 space-y-5" aria-label="새 자료 등록">
    <div className="flex flex-wrap items-center justify-between gap-3">
    <fieldset><legend className="sr-only">자료 종류</legend><div className="inline-flex rounded-lg bg-muted p-1">
      {([['book', '교재'], ['exam', '기출']] as const).map(([value, label]) => <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-4 text-sm font-medium ${kind === value ? 'bg-background text-foreground' : 'text-muted-foreground'}`}><input aria-label={label} type="radio" name="material-kind" value={value} checked={kind === value} onChange={() => select(value)} />{label}</label>)}
    </div></fieldset></div>
    {/* Keep visited forms mounted so switching material kind preserves local selections. */}
    {opened.book && <div hidden={kind !== 'book'}><BookUploadForm onRegistered={openBook} onBundleAccepted={() => setView('history')} /></div>}
    {opened.exam && <div hidden={kind !== 'exam'} className="space-y-3"><UploadDialog inline open onOpenChange={() => {}} onAccepted={() => setView('history')} /><div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><p>기존 기출에 해설지만 추가하려면</p><Button variant="ghost" className="min-h-11" onClick={() => setBulkOpen(true)}>일괄 해설 등록</Button></div></div>}
    </section>
    <section hidden={currentView !== 'history'} className="min-w-0 space-y-5" aria-label="등록 및 처리 내역">
      <BookBundleHistory bundles={bundles} jobs={jobs} onOpenBook={openBook} />
      <PdfImportJobList excludedTargetIds={bundles.flatMap(b => b.files.map(f => f.document_id))} onOpenBook={openBook} onOpenMaterial={onOpenMaterial} />
      {documents.length > 0 && <details className="text-sm"><summary className="min-h-11 cursor-pointer py-3">교재별 결과 찾기</summary>
        <label className="block space-y-2 text-sm">결과를 확인할 교재<select value="" onChange={(e) => openBook(e.target.value)} className="min-h-11 w-full rounded-xl border bg-background px-3 text-base"><option value="" disabled>교재 선택</option>{documents.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label>
      </details>}
    </section>
    <BulkExplanationDialog open={bulkOpen} onOpenChange={setBulkOpen} />
  </div>
}
