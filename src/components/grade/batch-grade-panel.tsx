'use client'

import { useState } from 'react'
import { ArrowLeft, FileText, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { MobileCapture, type CaptureView } from './mobile-capture'

export type BatchPhotoView = {
  id: string
  file: File
  previewUrl: string
  studentId: string | null
  rawName: string | null
  confidence: 'high' | 'low' | 'none'
  status: 'matching' | 'ready' | 'processing' | 'done' | 'error'
  message?: string
  duplicateName?: boolean
}

type Props = {
  open: boolean
  kind: 'exam' | 'vocab'
  draftKey: string
  phase: 'pick' | 'matching' | 'review' | 'processing' | 'done'
  items: BatchPhotoView[]
  students: { student_id: string; student_name: string; present: boolean; hasExisting: boolean }[]
  busy: boolean
  readyCount: number
  duplicateIds: Set<string>
  onClose: () => void
  onBack: () => void
  onConfirm: (files: File[]) => Promise<void>
  onCaptureBusy: (busy: boolean) => void
  onSelect: (id: string, studentId: string | null) => void
  onRemove: (id: string) => void
  onStart: () => Promise<void>
  onRetry: () => Promise<void>
}

export function BatchGradePanel(props: Props) {
  const { open, kind, draftKey, phase, items, students, busy, readyCount, duplicateIds,
    onClose, onBack, onConfirm, onCaptureBusy, onSelect, onRemove, onStart, onRetry } = props
  const [captureView, setCaptureView] = useState<CaptureView>('add')
  const done = items.filter((item) => item.status === 'done').length
  const failed = items.filter((item) => item.status === 'error').length
  const unmatched = items.filter((item) => !item.studentId).length
  const issue = (item: BatchPhotoView) => !item.studentId || duplicateIds.has(item.studentId) || item.confidence === 'low' || item.duplicateName
  const needsCheck = items.filter(issue).length
  const ordered = phase === 'review' ? [...items.filter(issue), ...items.filter((item) => !issue(item))] : items
  const processing = phase === 'matching' || phase === 'processing'
  const completed = phase === 'matching' ? items.filter((item) => item.status !== 'matching').length : done + failed
  const step = phase === 'pick' ? captureView === 'review' ? 1 : 0 : phase === 'matching' || phase === 'review' ? 2 : 3
  const title = phase === 'pick' ? captureView === 'camera' ? '답안 촬영' : captureView === 'review' ? '사진 확인' : '답안 추가'
    : phase === 'matching' ? '학생 이름을 읽고 있어요' : phase === 'review' ? '학생 확인'
      : phase === 'processing' ? kind === 'exam' ? '답안을 읽고 있어요' : '채점하고 있어요' : '처리 결과'
  const description = phase === 'pick' ? '학생당 한 장 · 이름과 답안 전체가 나오게 준비해주세요.'
    : phase === 'review' ? '사진과 학생이 맞는지 확인해주세요.'
      : phase === 'done' ? kind === 'exam' ? '채점표에서 답안을 확인하고 ‘채점 저장’으로 확정해주세요.' : '완료된 채점 결과는 저장되었습니다.'
        : '창을 닫지 말고 잠시 기다려주세요.'

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogContent showCloseButton={false} className="top-0 left-0 h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 rounded-none border-0 bg-[var(--share-canvas)] p-0 text-[var(--share-ink)] shadow-none sm:top-1/2 sm:left-1/2 sm:h-[min(820px,90dvh)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[20px]">
        <DialogHeader className="gap-3 border-b border-[var(--share-line)] px-4 py-4 text-left sm:px-6">
          <div className="flex items-center gap-2">
            {phase === 'review' && <Button type="button" variant="ghost" size="icon" aria-label="사진 확인으로 돌아가기" disabled={busy} onClick={onBack}><ArrowLeft className="size-5" /></Button>}
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-[11px] font-medium text-[var(--share-muted)]">{kind === 'exam' ? '진단평가 답안 판독' : '단어 시험 채점'}</p>
              <DialogTitle className="text-xl font-bold tracking-tight">{title}</DialogTitle>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="닫기" disabled={busy} onClick={onClose}><X className="size-5" /></Button>
          </div>
          <DialogDescription className="text-xs leading-relaxed text-[var(--share-muted)]">{description}</DialogDescription>
          <ol aria-label="답안 처리 단계" className="grid grid-cols-4 gap-2 text-[11px]">
            {['답안 추가', '사진 확인', '학생 확인', '처리 결과'].map((label, index) => (
              <li key={label} aria-current={index === step ? 'step' : undefined} className={cn('border-t-2 pt-2', index === step ? 'border-[var(--share-blue)] font-bold text-[var(--share-ink)]' : 'border-[var(--share-line)] text-[var(--share-muted2)]')}>{index + 1}. {label}</li>
            ))}
          </ol>
        </DialogHeader>

        <MobileCapture key={draftKey} draftKey={draftKey} active={open && phase === 'pick'} onConfirm={onConfirm} onBusyChange={onCaptureBusy} onViewChange={setCaptureView} />

        {phase !== 'pick' && (
          <div className="min-h-0 overflow-y-auto px-4 py-5 sm:px-6">
            <div className="mx-auto max-w-[520px] space-y-4">
              {processing && <div role="status" className="space-y-3 rounded-[20px] bg-[var(--share-card)] p-4">
                <p className="flex items-center gap-2 text-sm font-semibold"><Loader2 className="size-4 animate-spin" />{phase === 'matching' ? '이름 확인' : kind === 'exam' ? '답안 판독' : '채점'} {completed} / {items.length}장</p>
                <progress aria-label="처리 진행률" value={completed} max={Math.max(items.length, 1)} className="h-1.5 w-full accent-[var(--share-blue)]" />
              </div>}
              {phase === 'review' && <div className="flex items-center justify-between text-sm"><span className="font-semibold">답안 {items.length}장</span><span className={needsCheck ? 'text-[var(--share-red)]' : 'text-[var(--share-muted)]'}>{needsCheck ? `확인 필요 ${needsCheck}장` : '모든 학생이 연결되었습니다'}</span></div>}
              {phase === 'done' && <div role="status" className="rounded-[20px] bg-[var(--share-card)] p-5"><p className="text-xl font-bold">완료 {done}명{failed > 0 ? ` · 실패 ${failed}건` : ''}</p><p className="mt-2 text-xs leading-relaxed text-[var(--share-muted)]">{failed > 0 ? '실패한 답안만 다시 시도할 수 있습니다.' : '보관한 답안은 기기에 남아 있습니다.'}</p></div>}
              <ul className="space-y-3" aria-label="학생별 답안">
                {ordered.map((item) => {
                  const index = items.findIndex((original) => original.id === item.id)
                  const duplicate = !!item.studentId && duplicateIds.has(item.studentId)
                  const existing = students.find((student) => student.student_id === item.studentId)?.hasExisting
                  return <li key={item.id} className={cn('space-y-3 rounded-[20px] border bg-[var(--share-card)] p-4', duplicate || !item.studentId || item.status === 'error' ? 'border-[var(--share-red-bg)]' : 'border-transparent')}>
                    <div className="flex items-center gap-3">
                      {item.file.type.startsWith('image/') ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.previewUrl} alt={`답안 ${index + 1}`} className="h-16 w-12 shrink-0 rounded-lg bg-[var(--share-box)] object-contain" />
                      ) : <div className="flex h-16 w-12 shrink-0 flex-col items-center justify-center gap-1 rounded-lg bg-[var(--share-box)]"><FileText className="size-5" /><span className="text-[10px]">PDF</span></div>}
                      <div className="min-w-0 flex-1"><p className="text-sm font-bold">답안 {index + 1}</p><p className="mt-1 truncate text-xs text-[var(--share-muted)]">{item.file.name}</p><p className="mt-1 text-xs text-[var(--share-muted)]">{item.status === 'matching' ? '이름 읽는 중…' : item.rawName ? `읽은 이름: ${item.rawName}` : '이름을 직접 선택해주세요'}</p></div>
                      {phase === 'review' && <button type="button" disabled={busy} onClick={() => onRemove(item.id)} aria-label={`답안 ${index + 1} 이번 처리에서 제외`} className="min-h-11 shrink-0 rounded-lg px-2 text-xs text-[var(--share-muted)] focus-visible:outline-2">제외</button>}
                    </div>
                    {phase === 'review' && <>
                      <label className="block text-xs font-semibold">학생
                        <select aria-label={`답안 ${index + 1} 학생`} value={item.studentId ?? ''} disabled={busy} onChange={(event) => onSelect(item.id, event.target.value || null)} className="mt-2 h-11 w-full rounded-xl border border-[var(--share-line-strong)] bg-[var(--share-canvas)] px-3 text-sm font-medium text-[var(--share-ink)]">
                          <option value="">학생 선택</option>
                          {students.map((student) => <option key={student.student_id} value={student.student_id} disabled={!student.present}>{student.student_name}{student.present ? '' : ' (결석)'}</option>)}
                        </select>
                      </label>
                      {(duplicate || item.duplicateName || !item.studentId || item.confidence === 'low') && <p className="text-xs leading-relaxed text-[var(--share-red)]">{duplicate ? '같은 학생에게 두 장이 연결됐어요. 학생을 바꾸거나 한 장을 제외해주세요.' : item.duplicateName ? '동명이인입니다. 학생을 직접 선택해주세요.' : !item.studentId ? '학생을 선택하지 않으면 이번 처리에서 제외됩니다.' : '이름 판독이 불확실해요. 학생이 맞는지 확인해주세요.'}</p>}
                      {existing && <p className="text-xs text-[var(--share-muted)]">기존 답안이 있습니다. 시작 전에 덮어쓰기를 확인합니다.</p>}
                    </>}
                    {item.message && <p className={cn('break-words text-sm', item.status === 'error' ? 'text-[var(--share-red)]' : 'text-[var(--share-body)]')}>{item.message}</p>}
                  </li>
                })}
              </ul>
            </div>
          </div>
        )}

        {phase !== 'pick' && <footer className="border-t border-[var(--share-line)] px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-6">
          <div className="mx-auto max-w-[520px] space-y-3">
            {phase === 'review' && <>
              <p className="text-xs text-[var(--share-muted)]">{duplicateIds.size > 0 ? `중복 학생 ${duplicateIds.size}명을 먼저 확인해주세요.` : unmatched > 0 ? `미선택 ${unmatched}장은 이번 처리에서 제외됩니다.` : '사진은 이 기기에 보관됩니다.'}</p>
              <Button type="button" variant="action" disabled={busy || readyCount === 0 || duplicateIds.size > 0} onClick={onStart} className="h-12 w-full rounded-xl">{readyCount}명 {kind === 'exam' ? '답안 읽기' : '채점하기'}</Button>
            </>}
            {processing && <p className="py-2 text-center text-sm text-[var(--share-muted)]">완료 {completed} / 전체 {items.length}장</p>}
            {phase === 'done' && <div className="flex gap-2">
              {failed > 0 && <Button type="button" variant="action" disabled={busy} onClick={onRetry} className="h-12 flex-1 rounded-xl">실패 {failed}건 재시도</Button>}
              <Button type="button" variant="outline" onClick={onClose} className="h-12 flex-1 rounded-xl shadow-none">{kind === 'exam' ? '채점표 확인' : '완료'}</Button>
            </div>}
          </div>
        </footer>}
      </DialogContent>
    </Dialog>
  )
}
