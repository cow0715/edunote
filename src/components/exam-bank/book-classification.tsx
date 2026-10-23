'use client'

import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BOOK_CATALOG, VOLUME_LABELS, bookTitle, type BookCode, type BookVolume } from '@/lib/book-pdf/catalog'
import type { BookDocument } from '@/lib/book-pdf/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

type ClassificationDocument = Pick<BookDocument, 'id' | 'title' | 'academic_year' | 'book_code' | 'volume' | 'revision'>
export type Classification = { bookCode: BookCode | ''; academicYear: number; volume: BookVolume }
export function BookClassificationFields({ value, onChange, disabled, lockedCode }: {
  value: Classification; onChange: (value: Classification) => void; disabled?: boolean; lockedCode?: BookCode | null
}) {
  const id = useId(), nextYear = new Date().getFullYear() + 1
  const years = [...new Set([value.academicYear, ...Array.from({ length: 12 }, (_, i) => nextYear + 1 - i)])].sort((a, b) => b - a)
  return <div className="space-y-4">
    <label className="block space-y-1 text-sm"><span>학년도</span>
      <select value={value.academicYear} disabled={disabled} onChange={(e) => onChange({ ...value, academicYear: Number(e.target.value) })} className="h-11 w-full rounded-lg border bg-background px-3 sm:max-w-48">
        {years.map((year) => <option key={year} value={year}>{year}학년도</option>)}
      </select>
    </label>
    <fieldset disabled={disabled} className="space-y-2"><legend className="mb-2 text-sm font-medium">교재 선택</legend>
      {BOOK_CATALOG.map((book) => <label key={book.code} className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-3 ${value.bookCode === book.code ? 'border-foreground/40 bg-muted' : 'border-border bg-background'} ${lockedCode && lockedCode !== book.code ? 'cursor-not-allowed opacity-50' : ''}`}>
        <input type="radio" name={`${id}-book`} value={book.code} checked={value.bookCode === book.code} disabled={!!lockedCode && lockedCode !== book.code} onChange={() => onChange({ ...value, bookCode: book.code })} className="mt-1" />
        <span className="min-w-0"><span className="block text-sm font-medium">{book.label}</span><span className="mt-1 block text-xs text-muted-foreground">{book.description}</span></span>
      </label>)}
    </fieldset>
    <fieldset disabled={disabled}><legend className="mb-2 text-sm font-medium">분권</legend><div className="flex flex-wrap gap-2">
      {(Object.entries(VOLUME_LABELS) as [BookVolume, string][]).map(([volume, label]) => <label key={volume} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4 text-sm ${value.volume === volume ? 'bg-muted border-foreground/40' : 'bg-background'}`}>
        <input type="radio" name={`${id}-volume`} value={volume} checked={value.volume === volume} onChange={() => onChange({ ...value, volume })} />{label}
      </label>)}
    </div></fieldset>
  </div>
}

export function BookClassificationDialog({ document, onClose }: { document: ClassificationDocument | null; onClose: () => void }) {
  return <Dialog open={!!document} onOpenChange={(open) => { if (!open) onClose() }}><DialogContent>
    <DialogHeader><DialogTitle>교재 분류 수정</DialogTitle><DialogDescription>등록된 문항과 검증 결과를 유지하고 분류·표시명만 바꿉니다. AI 재파싱은 실행하지 않습니다.</DialogDescription></DialogHeader>
    {document && <ClassificationForm key={`${document.id}:${document.revision}`} document={document} onClose={onClose} />}
  </DialogContent></Dialog>
}
function ClassificationForm({ document, onClose }: { document: ClassificationDocument; onClose: () => void }) {
  const [value, setValue] = useState<Classification>({ bookCode: document.book_code ?? '', academicYear: document.academic_year ?? new Date().getFullYear() + 1, volume: document.volume ?? 'full' })
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), client = useQueryClient()
  async function save() {
    setSaving(true); setError('')
    try {
      const response = await fetch(`/api/book-pdf/${document.id}/classification`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...value, revision: document.revision }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '분류 저장 실패')
      await Promise.all(['book-pdf', 'exam-bank', 'exam-bank-search', 'exam-bank-question-search', 'vocab-collections', 'pdf-import-jobs'].map((key) => client.invalidateQueries({ queryKey: [key] })))
      toast.success('교재 분류를 저장했습니다. 문항을 다시 파싱하지 않았습니다.'); onClose()
    } catch (e) { setError(e instanceof Error ? e.message : '분류 저장 실패') }
    finally { setSaving(false) }
  }
  return <div className="space-y-4">
    <BookClassificationFields value={value} onChange={setValue} disabled={saving} lockedCode={document.book_code} />
    {value.bookCode && <p className="text-sm text-muted-foreground">표시명: {bookTitle(value.bookCode, value.academicYear, value.volume)}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button variant="action" disabled={saving || !value.bookCode} onClick={() => void save()} className="min-h-11 w-full">{saving ? '저장 중…' : '분류 저장'}</Button>
  </div>
}
