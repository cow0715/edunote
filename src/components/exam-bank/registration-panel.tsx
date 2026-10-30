'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { BookUploadForm } from './book-upload-form'
import { BookResult } from './book-import-panel'
import { UploadDialog } from './upload-dialog'
import { BulkExplanationDialog } from './bulk-explanation-dialog'
import { PdfImportJobList } from '@/components/pdf-import/job-list'
import { BookBundleHistory, useBookBundles } from './book-bundle'

export function RegistrationPanel({ documentId, onOpenBook, onOpenMaterial }: {
  documentId: string | null; onOpenBook: (id: string) => void; onOpenMaterial: (id: string) => void
}) {
  const [kind, setKind] = useState<'book' | 'exam'>('book'), [bulkOpen, setBulkOpen] = useState(false)
  const [opened, setOpened] = useState({ book: true, exam: false })
  const bundles = useBookBundles().data?.bundles ?? []
  function select(value: 'book' | 'exam') { setKind(value); setOpened((previous) => ({ ...previous, [value]: true })) }
  return <div className="mx-auto w-full max-w-3xl space-y-8">
    <section className="min-w-0 space-y-5" aria-label="새 자료 등록">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">새 자료 등록</h2>
    <fieldset><legend className="sr-only">자료 종류</legend><div className="inline-flex rounded-lg bg-muted p-1">
      {([['book', '교재'], ['exam', '기출']] as const).map(([value, label]) => <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-4 text-sm font-medium ${kind === value ? 'bg-background text-foreground' : 'text-muted-foreground'}`}><input aria-label={label} type="radio" name="material-kind" value={value} checked={kind === value} onChange={() => select(value)} />{label}</label>)}
    </div></fieldset></div>
    {/* Keep visited forms mounted so switching material kind preserves local selections. */}
    {opened.book && <div hidden={kind !== 'book'}><BookUploadForm onRegistered={onOpenBook} /></div>}
    {opened.exam && <div hidden={kind !== 'exam'} className="space-y-3"><UploadDialog inline open onOpenChange={() => {}} /><div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><p>기존 기출에 해설지만 추가하려면</p><Button variant="ghost" className="min-h-11" onClick={() => setBulkOpen(true)}>일괄 해설 등록</Button></div></div>}
    </section>
    {documentId && <div id="book-result"><BookResult key={documentId} id={documentId} /></div>}
    <section className="min-w-0 space-y-5 border-t pt-6" aria-label="등록 및 처리 내역"><BookBundleHistory bundles={bundles} onOpenBook={onOpenBook} /><PdfImportJobList excludedTargetIds={bundles.flatMap(b => b.files.map(f => f.document_id))} onOpenBook={onOpenBook} onOpenMaterial={onOpenMaterial} /></section>
    <BulkExplanationDialog open={bulkOpen} onOpenChange={setBulkOpen} />
  </div>
}
