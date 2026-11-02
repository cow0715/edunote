'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { BookUploadForm, useBookDocuments } from './book-upload-form'
import { BookResult } from './book-import-panel'
import { UploadDialog } from './upload-dialog'
import { BulkExplanationDialog } from './bulk-explanation-dialog'
import { PdfImportJobList } from '@/components/pdf-import/job-list'
import { BookBundleHistory, useBookBundles } from './book-bundle'
import { RECOVERED_BOOK } from './book-processing-summary'

export function RegistrationPanel({ documentId, materialId, onOpenBook, onOpenMaterial }: {
  documentId: string | null; materialId?: string | null; onOpenBook: (id: string) => void; onOpenMaterial: (id: string) => void
}) {
  const [kind, setKind] = useState<'book' | 'exam'>('book'), [bulkOpen, setBulkOpen] = useState(false)
  const [opened, setOpened] = useState({ book: true, exam: false })
  const bundles = useBookBundles().data?.bundles ?? []
  const books = useBookDocuments()
  const documents = books.data?.documents ?? []
  const selectedDocument = documentId || documents.find((d) => d.exam_bank_id === materialId)?.id || (materialId === RECOVERED_BOOK.bankId ? documents.find((d) => d.id === RECOVERED_BOOK.documentId)?.id : null) || documents[0]?.id
  function select(value: 'book' | 'exam') { setKind(value); setOpened((previous) => ({ ...previous, [value]: true })) }
  return <div className="mx-auto w-full max-w-3xl space-y-8">
    <section aria-label="교재 등록 결과" className="space-y-4">
      <div className="space-y-1"><h2 className="text-lg font-semibold">등록한 교재는 어디까지 준비됐나요?</h2><p className="text-sm text-muted-foreground">저장된 문제 수와 아직 사용할 수 없는 문항의 이유를 확인하세요.</p></div>
      {books.error && <div role="alert"><p className="text-sm">{books.error.message}</p><Button variant="outline" onClick={() => void books.refetch()}>교재 목록 다시 불러오기</Button></div>}
      {documents.length > 0 && <label className="block space-y-2 text-sm">결과를 확인할 교재<select value={selectedDocument} onChange={(e) => onOpenBook(e.target.value)} className="min-h-11 w-full rounded-xl border bg-background px-3 text-base">{documents.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label>}
      {selectedDocument ? <div id="book-result"><BookResult key={selectedDocument} id={selectedDocument} /></div> : <p className="text-sm text-muted-foreground">{books.isPending ? '교재 목록을 불러오는 중…' : '등록한 교재가 없습니다. 아래에서 새 자료를 등록할 수 있습니다.'}</p>}
    </section>
    <section className="min-w-0 space-y-5" aria-label="새 자료 등록">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">새 자료 등록</h2>
    <fieldset><legend className="sr-only">자료 종류</legend><div className="inline-flex rounded-lg bg-muted p-1">
      {([['book', '교재'], ['exam', '기출']] as const).map(([value, label]) => <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-4 text-sm font-medium ${kind === value ? 'bg-background text-foreground' : 'text-muted-foreground'}`}><input aria-label={label} type="radio" name="material-kind" value={value} checked={kind === value} onChange={() => select(value)} />{label}</label>)}
    </div></fieldset></div>
    {/* Keep visited forms mounted so switching material kind preserves local selections. */}
    {opened.book && <div hidden={kind !== 'book'}><BookUploadForm onRegistered={onOpenBook} /></div>}
    {opened.exam && <div hidden={kind !== 'exam'} className="space-y-3"><UploadDialog inline open onOpenChange={() => {}} /><div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><p>기존 기출에 해설지만 추가하려면</p><Button variant="ghost" className="min-h-11" onClick={() => setBulkOpen(true)}>일괄 해설 등록</Button></div></div>}
    </section>
    <section className="min-w-0 space-y-5 border-t pt-6" aria-label="등록 및 처리 내역"><BookBundleHistory bundles={bundles} onOpenBook={onOpenBook} /><PdfImportJobList excludedTargetIds={bundles.flatMap(b => b.files.map(f => f.document_id))} onOpenBook={onOpenBook} onOpenMaterial={onOpenMaterial} /></section>
    <BulkExplanationDialog open={bulkOpen} onOpenChange={setBulkOpen} />
  </div>
}
