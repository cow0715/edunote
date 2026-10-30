'use client'
import { BOOK_FILE_BUDGET_USD } from '@/lib/pdf-import/cost-limits'

import { useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { examPdfUploadPath } from '@/lib/pdf-import/client'
import { bookFileHints, bookTitle } from '@/lib/book-pdf/catalog'
import { bookFileIssue, bookSelectionIssue, inferBookSelection } from '@/lib/book-pdf/registration-selection'
import type { BookDocument } from '@/lib/book-pdf/types'
import { BookClassificationFields, type Classification } from './book-classification'
import { FileUpload } from '@/components/ui/file-upload'
import { BookBundleUpload } from './book-bundle'
import { Button } from '@/components/ui/button'

export function useBookDocuments() {
  return useQuery<{ enabled: boolean; documents: BookDocument[] }>({ queryKey: ['book-pdf'], queryFn: async () => {
    const response = await fetch('/api/book-pdf', { cache: 'no-store' }), data = await response.json()
    if (!response.ok) throw new Error(data.error || '교재 자료 조회 실패')
    return data
  }, refetchInterval: (q) => q.state.data?.documents.some((d) => d.status === 'processing') ? 15_000 : false })
}
export function BookUploadForm({ onRegistered }: { onRegistered: (id: string) => void }) {
  const [bundleMode, setBundleMode] = useState(false)
  const [value, setValue] = useState<Classification>({ bookCode: '', academicYear: new Date().getFullYear() + 1, volume: 'full' })
  const [file, setFile] = useState<File | null>(null), [pages, setPages] = useState<number | null>(null)
  const [checking, setChecking] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null), selection = useRef(0), submitting = useRef(false), statusId = useId(), client = useQueryClient(), list = useBookDocuments()
  const title = value.bookCode ? bookTitle(value.bookCode, value.academicYear, value.volume) : ''
  const hints = file ? bookFileHints(file.name) : null
  const selectionIssue = bookSelectionIssue(value, file?.name)
  const ready = !!file && !!pages && !selectionIssue && !error && !!list.data?.enabled && !list.error && !checking && !uploading
  const feedback = error || list.error?.message || (file ? selectionIssue : null)
  const status = feedback || (checking ? 'PDF 페이지 수를 확인하고 있습니다.'
    : uploading ? '파일 업로드·등록 접수 중입니다.'
      : list.isPending ? '등록 가능 상태를 확인하고 있습니다.'
        : !list.data?.enabled ? '지금은 교재 등록을 이용할 수 없습니다. 잠시 후 다시 시도해주세요.'
          : !file ? 'PDF를 선택하면 파일명에 맞는 교재·분권을 자동으로 채웁니다.'
            : !pages ? 'PDF 페이지를 확인해주세요.' : '등록 준비 완료 · 아래 버튼을 누르면 접수됩니다.')
  async function choose(next: File | null) {
    const turn = ++selection.current
    setFile(next); setPages(null); setError(''); setChecking(!!next)
    if (!next) { if (fileRef.current) fileRef.current.value = ''; return }
    const fileError = bookFileIssue(next)
    if (fileError) { setError(fileError); setChecking(false); return }
    setValue((v) => inferBookSelection(v, next.name))
    try {
      const { PDFDocument } = await import('pdf-lib')
      const pdf = await PDFDocument.load(await next.arrayBuffer())
      if (pdf.getPageCount() > 600) throw new Error('PDF는 600페이지 이하로 올려주세요.')
      if (turn === selection.current) setPages(pdf.getPageCount())
    } catch (e) { if (turn === selection.current) setError(e instanceof Error && e.message.includes('600') ? e.message : 'PDF를 읽지 못했습니다. 암호화 여부와 파일을 확인해주세요.') }
    finally { if (turn === selection.current) setChecking(false) }
  }
  async function upload() {
    if (!ready || !file || submitting.current) return
    submitting.current = true
    setUploading(true); setError('')
    try {
      const supabase = createClient(), path = await examPdfUploadPath(supabase, file.name)
      const result = await supabase.storage.from('exam-pdf-temp').upload(path, file, { contentType: 'application/pdf' })
      if (result.error) throw new Error(result.error.message)
      const response = await fetch('/api/book-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...value, fileName: file.name, storagePath: path }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '교재 등록 실패')
      await Promise.all(['book-pdf', 'pdf-import-jobs', 'book-bundles'].map((key) => client.invalidateQueries({ queryKey: [key] })))
      onRegistered(data.document_id)
      toast.success(data.reused ? '동일한 파일의 기존 자료를 열었습니다. 재파싱하지 않았습니다.' : '등록을 접수했습니다. 이 화면을 닫아도 계속 처리합니다.')
      await choose(null)
    } catch (e) { setError(e instanceof Error ? e.message : '교재 등록 실패') }
    finally { submitting.current = false; setUploading(false) }
  }
  if (bundleMode) return <BookBundleUpload onBack={() => setBundleMode(false)} />
  return <section className="space-y-5" aria-label="교재 PDF 등록">
    <div className="flex justify-end"><Button variant="ghost" className="min-h-11" onClick={() => setBundleMode(true)}>여러 교재 함께 등록</Button></div>
    <div className="space-y-2"><p className="text-sm font-medium">교재 PDF</p><FileUpload compact className="w-full [&>button:first-of-type]:min-h-14 [&>button:first-of-type]:w-full [&>button:first-of-type]:justify-start" label="교재 원본 PDF 선택" description="PDF 1개 · 50MB 이하 · 최대 600페이지" accept="application/pdf,.pdf" inputRef={fileRef} fileName={file?.name} disabled={uploading} loading={checking} onChange={(e) => void choose(e.target.files?.[0] ?? null)} onClear={() => void choose(null)} /><p className="text-xs text-muted-foreground">PDF 1개 · 50MB 이하 · 최대 600페이지{file && hints?.code ? ' · 파일명으로 교재·분권을 채웠습니다.' : ''}</p></div>
    <BookClassificationFields compact value={value} onChange={setValue} disabled={uploading} />
    {hints?.year && hints.year !== value.academicYear && <p className="text-xs leading-relaxed text-muted-foreground">파일명에는 {hints.year}년이 있습니다. 책에 적힌 학년도를 확인해주세요.</p>}
    <div className="space-y-3 border-t pt-4">
      <p id={statusId} role={feedback ? 'alert' : 'status'} className={ready ? 'sr-only' : `text-sm leading-relaxed ${feedback ? 'text-destructive' : 'text-muted-foreground'}`}>{status}</p>
      {list.error && <Button variant="outline" className="min-h-11" onClick={() => void list.refetch()}>다시 불러오기</Button>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 space-y-1"><p className="text-sm font-medium leading-relaxed">{title || '등록할 교재를 선택해주세요.'}</p>{!!pages && <p className="text-xs text-muted-foreground">{pages}페이지 · {file ? `${(file.size / 1024 / 1024).toFixed(1)}MB` : ''}</p>}</div><Button variant="action" className="min-h-11 shrink-0 sm:px-6" aria-describedby={statusId} disabled={!ready} onClick={() => void upload()}>{uploading ? '파일 업로드·등록 접수 중…' : '교재 등록 시작'}</Button></div>
      <p className="text-xs leading-relaxed text-muted-foreground">AI 처리 예산은 파일당 최대 ${BOOK_FILE_BUDGET_USD}입니다. 이미 사용한 비용과 접수 예정 비용을 합산하며, 예산 초과나 반복 오류가 감지되면 중지합니다. 전체 검증을 통과한 뒤 문제은행·단어장에서 사용할 수 있습니다.</p>
    </div>
    <details className="text-xs leading-relaxed text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3">지원 형식 안내</summary><p>확인한 좌본문·우해석 PDF를 지원합니다. 원본 대조와 오류 복구, 풀이·어휘 보완을 포함하며 전체 검증을 통과한 뒤 반영합니다. 동일한 파일은 기존 자료로 연결합니다.</p></details>
  </section>
}
