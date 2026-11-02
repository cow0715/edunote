'use client'

import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BOOK_CATALOG, VOLUME_LABELS, bookTitle, bookVolumes, validBookVolume, type BookCode } from '@/lib/book-pdf/catalog'
import type { BookSelection } from '@/lib/book-pdf/registration-selection'
import type { BookDocument } from '@/lib/book-pdf/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

type ClassificationDocument = Pick<BookDocument, 'id' | 'title' | 'academic_year' | 'book_code' | 'volume' | 'revision'>
export type Classification = BookSelection
export function BookClassificationFields({ value, onChange, disabled, lockedCode, compact = false }: {
  value: Classification; onChange: (value: Classification) => void; disabled?: boolean; lockedCode?: BookCode | null; compact?: boolean
}) {
  const id = useId(), nextYear = new Date().getFullYear() + 1
  const years = [...new Set([value.academicYear, ...Array.from({ length: 12 }, (_, i) => nextYear + 1 - i)])].sort((a, b) => b - a)
  if (compact) return <div className="space-y-2">
    <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)_140px]">
      <label className="space-y-2 text-sm"><span className="block font-medium">학년도</span><select value={value.academicYear} disabled={disabled} onChange={(e) => onChange({ ...value, academicYear: Number(e.target.value) })} aria-describedby={`${id}-year-hint`} className="h-11 w-full rounded-lg border bg-background px-3 text-base sm:text-sm">{years.map((year) => <option key={year} value={year}>{year}학년도</option>)}</select></label>
      <label className="min-w-0 space-y-2 text-sm"><span className="block font-medium">교재</span><select value={value.bookCode} disabled={disabled} onChange={(e) => { const code = e.target.value as BookCode; onChange({ ...value, bookCode: code, volume: validBookVolume(code, value.volume) ? value.volume : 'full' }) }} className="h-11 w-full rounded-lg border bg-background px-3 text-base sm:text-sm"><option value="" disabled>교재 선택</option>{BOOK_CATALOG.map((book) => <option key={book.code} value={book.code} disabled={!!lockedCode && lockedCode !== book.code}>{book.label}</option>)}</select></label>
      <label className="space-y-2 text-sm"><span className="block font-medium">분권</span><select value={value.volume} disabled={disabled} onChange={(e) => onChange({ ...value, volume: e.target.value as Classification['volume'] })} className="h-11 w-full rounded-lg border bg-background px-3 text-base sm:text-sm">{bookVolumes(value.bookCode).map((volume) => <option key={volume} value={volume}>{VOLUME_LABELS[volume]}</option>)}</select></label>
    </div>
    <p id={`${id}-year-hint`} className="text-xs text-muted-foreground">학년도는 교재 표지 기준입니다.</p>
  </div>
  return <div className="space-y-4">
    <fieldset disabled={disabled}><legend className="mb-2 text-sm font-medium">교재 선택</legend><div className="grid gap-2 sm:grid-cols-3">
      {BOOK_CATALOG.map((book) => <label key={book.code} className={`flex min-h-20 cursor-pointer items-start gap-2.5 rounded-xl border p-3 ${value.bookCode === book.code ? 'border-foreground/40 bg-muted' : 'border-border bg-background'} ${lockedCode && lockedCode !== book.code ? 'cursor-not-allowed opacity-50' : ''}`}>
        <input type="radio" name={`${id}-book`} value={book.code} checked={value.bookCode === book.code} disabled={!!lockedCode && lockedCode !== book.code} onChange={() => onChange({ ...value, bookCode: book.code, volume: validBookVolume(book.code, value.volume) ? value.volume : 'full' })} className="mt-1" />
        <span className="min-w-0"><span className="block text-sm font-medium leading-relaxed">{book.label}</span><span className="mt-1 block text-xs text-muted-foreground">{book.code === 'suwan_english' ? '유형편 · 실전편' : '상 · 하 · 전체'}</span></span>
      </label>)}
    </div></fieldset>
    <div className="grid gap-4 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
    <label className="block space-y-2 text-sm"><span className="font-medium">학년도</span>
      <select value={value.academicYear} disabled={disabled} onChange={(e) => onChange({ ...value, academicYear: Number(e.target.value) })} className="h-11 w-full rounded-lg border bg-background px-3 text-base sm:text-sm" aria-describedby={`${id}-year-hint`}>
        {years.map((year) => <option key={year} value={year}>{year}학년도</option>)}
      </select>
    </label>
    <fieldset disabled={disabled}><legend className="mb-2 text-sm font-medium">분권</legend><div className="flex flex-wrap gap-2">
      {bookVolumes(value.bookCode).map((volume) => <label key={volume} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4 text-sm ${value.volume === volume ? 'bg-muted border-foreground/40' : 'bg-background'}`}>
        <input type="radio" name={`${id}-volume`} value={volume} checked={value.volume === volume} onChange={() => onChange({ ...value, volume })} />{VOLUME_LABELS[volume]}
      </label>)}
    </div></fieldset></div>
    <p id={`${id}-year-hint`} className="text-xs leading-relaxed text-muted-foreground">학년도는 교재 표지를 기준으로 선택하세요. 파일명에 적힌 연도와 다를 수 있습니다.</p>
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
