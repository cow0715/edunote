'use client'

import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { examPdfUploadPath } from '@/lib/pdf-import/client'
import { bookFileHints, bookTitle, getBook } from '@/lib/book-pdf/catalog'
import type { BookDocument } from '@/lib/book-pdf/types'
import { BookClassificationFields, type Classification } from './book-classification'
import { FileUpload } from '@/components/ui/file-upload'
import { Button } from '@/components/ui/button'

export function useBookDocuments() {
  return useQuery<{ enabled: boolean; documents: BookDocument[] }>({ queryKey: ['book-pdf'], queryFn: async () => {
    const response = await fetch('/api/book-pdf', { cache: 'no-store' }), data = await response.json()
    if (!response.ok) throw new Error(data.error || '교재 자료 조회 실패')
    return data
  }, refetchInterval: (q) => q.state.data?.documents.some((d) => d.status === 'processing') ? 15_000 : false })
}
export function BookUploadForm({ onRegistered }: { onRegistered: (id: string) => void }) {
  const [value, setValue] = useState<Classification>({ bookCode: '', academicYear: new Date().getFullYear() + 1, volume: 'full' })
  const [file, setFile] = useState<File | null>(null), [pages, setPages] = useState<number | null>(null)
  const [checking, setChecking] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null), selection = useRef(0), client = useQueryClient(), list = useBookDocuments()
  const book = getBook(value.bookCode), title = value.bookCode ? bookTitle(value.bookCode, value.academicYear, value.volume) : ''
  const hints = file ? bookFileHints(file.name) : null
  const mismatch = !!hints?.code && hints.code !== value.bookCode
  async function choose(next: File | null) {
    const turn = ++selection.current
    setFile(next); setPages(null); setError(''); setChecking(!!next)
    if (!next) { if (fileRef.current) fileRef.current.value = ''; return }
    if (!/\.pdf$/i.test(next.name) || next.size > 50 * 1024 * 1024) { setError('50MB 이하의 PDF 파일을 선택해주세요.'); setChecking(false); return }
    const inferred = bookFileHints(next.name)
    setValue((v) => ({ ...v, ...(!v.bookCode && inferred.code ? { bookCode: inferred.code } : {}), ...(inferred.volume ? { volume: inferred.volume } : {}) }))
    try {
      const { PDFDocument } = await import('pdf-lib')
      const pdf = await PDFDocument.load(await next.arrayBuffer())
      if (pdf.getPageCount() > 600) throw new Error('PDF는 600페이지 이하로 올려주세요.')
      if (turn === selection.current) setPages(pdf.getPageCount())
    } catch (e) { if (turn === selection.current) setError(e instanceof Error && e.message.includes('600') ? e.message : 'PDF를 읽지 못했습니다. 암호화 여부와 파일을 확인해주세요.') }
    finally { if (turn === selection.current) setChecking(false) }
  }
  async function upload() {
    if (!file || !book?.supported || !pages || mismatch || uploading) return
    setUploading(true); setError('')
    try {
      const supabase = createClient(), path = await examPdfUploadPath(supabase, file.name)
      const result = await supabase.storage.from('exam-pdf-temp').upload(path, file, { contentType: 'application/pdf' })
      if (result.error) throw new Error(result.error.message)
      const response = await fetch('/api/book-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...value, fileName: file.name, storagePath: path }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '교재 등록 실패')
      await Promise.all(['book-pdf', 'pdf-import-jobs'].map((key) => client.invalidateQueries({ queryKey: [key] })))
      onRegistered(data.document_id)
      toast.success(data.reused ? '동일한 파일의 기존 자료를 열었습니다. 재파싱하지 않았습니다.' : '등록을 접수했습니다. 이 화면을 닫아도 계속 처리합니다.')
      await choose(null)
    } catch (e) { setError(e instanceof Error ? e.message : '교재 등록 실패') }
    finally { setUploading(false) }
  }
  return <section className="space-y-5 rounded-xl border bg-card p-4 sm:p-5" aria-label="교재 PDF 등록">
    <h2 className="font-semibold">교재 PDF 등록</h2>
    <BookClassificationFields value={value} onChange={setValue} disabled={uploading} />
    {book && !book.supported && <p role="status" className="rounded-lg bg-muted p-3 text-sm">이 교재는 PDF 형식을 확인하기 전입니다. 현재는 등록을 실행할 수 없습니다.</p>}
    <FileUpload label="교재 원본 PDF 선택" description="PDF · 최대 50MB · 확인된 좌본문·우해석 형식" accept="application/pdf,.pdf" inputRef={fileRef} fileName={file?.name} disabled={uploading || !book?.supported} loading={checking} onChange={(e) => void choose(e.target.files?.[0] ?? null)} onClear={() => void choose(null)} />
    {title && <div className="space-y-1 rounded-lg bg-muted p-3 text-sm" aria-live="polite"><p className="font-medium">{title}</p>{file && <p className="break-all text-muted-foreground">{file.name}{pages && ` · ${pages}페이지`}</p>}
      {book?.supported && <p className="text-muted-foreground">원본 대조·오류 복구와 풀이·어휘 보완을 포함합니다. 전체 검증 통과 후 문제은행·단어장에 반영합니다.</p>}
      {book?.supported && <p className="text-xs text-muted-foreground">교재는 비동기로 처리합니다. 완료 여부는 등록·처리에서 확인할 수 있습니다.</p>}
      {hints?.year && hints.year !== value.academicYear && <p className="text-xs text-muted-foreground">파일명에는 {hints.year}년이 있습니다. 학년도는 PDF 인쇄 정보와 대조합니다.</p>}
    </div>}
    {mismatch && <p role="alert" className="text-sm text-destructive">선택한 교재와 파일명이 다릅니다. 교재 선택을 확인해주세요.</p>}
    {(error || list.error) && <p role="alert" className="text-sm text-destructive">{error || list.error?.message}</p>}
    {list.data && !list.data.enabled && <p className="text-sm text-muted-foreground">교재 등록 설정을 준비 중입니다.</p>}
    <Button variant="action" className="min-h-11 w-full sm:w-auto" disabled={!list.data?.enabled || !book?.supported || !file || !pages || mismatch || uploading || checking} onClick={() => void upload()}>{uploading ? '파일 업로드·등록 접수 중…' : '교재 등록 시작'}</Button>
  </section>
}
