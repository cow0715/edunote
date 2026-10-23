'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { BookUploadForm } from './book-upload-form'
import { BookResult } from './book-import-panel'
import { UploadDialog } from './upload-dialog'
import { BulkExplanationDialog } from './bulk-explanation-dialog'
import { PdfImportJobList } from '@/components/pdf-import/job-list'

export function RegistrationPanel({ documentId, onOpenBook, onOpenMaterial }: {
  documentId: string | null; onOpenBook: (id: string) => void; onOpenMaterial: (id: string) => void
}) {
  const [kind, setKind] = useState<'book' | 'exam' | null>(null), [bulkOpen, setBulkOpen] = useState(false)
  return <div className="space-y-6">
    <div className="space-y-2"><h2 className="text-lg font-semibold">자료 등록</h2><p className="text-sm text-muted-foreground">자료 종류를 선택해 PDF를 올려주세요. 접수 후에는 다른 화면으로 이동해도 계속 처리합니다.</p></div>
    <fieldset><legend className="mb-2 text-sm font-medium">자료 종류</legend><div className="grid grid-cols-2 gap-3">
      {([['book', '교재'], ['exam', '기출']] as const).map(([value, label]) => <label key={value} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 ${kind === value ? 'border-foreground/40 bg-muted' : 'bg-card'}`}><input type="radio" name="material-kind" value={value} checked={kind === value} onChange={() => setKind(value)} /><span className="font-medium">{label}</span></label>)}
    </div></fieldset>
    {kind === 'book' && <BookUploadForm onRegistered={onOpenBook} />}
    {kind === 'exam' && <div className="space-y-3"><UploadDialog inline open onOpenChange={() => {}} /><div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"><span>이미 등록한 기출에 해설지를 추가하려면</span><Button variant="outline" className="min-h-11" onClick={() => setBulkOpen(true)}>일괄 해설 등록</Button></div></div>}
    <section className="space-y-3" aria-label="등록 및 처리 내역"><PdfImportJobList onOpenBook={onOpenBook} onOpenMaterial={onOpenMaterial} /></section>
    {documentId && <div id="book-result"><BookResult key={documentId} id={documentId} /></div>}
    <BulkExplanationDialog open={bulkOpen} onOpenChange={setBulkOpen} />
  </div>
}
