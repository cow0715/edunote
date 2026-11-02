'use client'

import { useState } from 'react'
import { ArrowLeft, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { ExamStudentConfirmationCard } from './exam-student-confirmation-card'
import { MobileCapture, type CaptureView } from './mobile-capture'

export type BatchPhotoView = {
  id: string
  file: File
  previewUrl: string
  studentId: string | null
  confirmedStudentId?: string | null
  rawName: string | null
  confidence: 'high' | 'low' | 'none'
  status: 'matching' | 'ready' | 'processing' | 'done' | 'error'
  message?: string
  duplicateName?: boolean
}

type Props = {
  onContinue?: () => Promise<void>
  continueDisabled?: boolean
  continuing?: boolean
  continueError?: string | null
  open: boolean
  kind: 'exam' | 'vocab'
  draftKey: string
  phase: 'pick' | 'matching' | 'review' | 'processing' | 'done'
  items: BatchPhotoView[]
  students: { student_id: string; student_name: string; present: boolean; hasExisting: boolean }[]
  busy: boolean
  readyCount: number
  canStart: boolean
  onConfirmStudent: (id:string)=>void
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
    onClose, onBack, onConfirm, onCaptureBusy, onSelect, onRemove, onStart, onRetry, canStart, onConfirmStudent, onContinue, continueDisabled, continuing, continueError } = props
  const [captureView, setCaptureView] = useState<CaptureView>('add')
  const done = items.filter((item) => item.status === 'done').length
  const failed = items.filter((item) => item.status === 'error').length
  const unmatched = items.filter((item) => !item.studentId).length
  const issue = (item: BatchPhotoView) => !item.studentId || duplicateIds.has(item.studentId) || item.confidence === 'low' || item.duplicateName
  const needsCheck = items.filter(item=>!item.studentId || duplicateIds.has(item.studentId) || item.confirmedStudentId !== item.studentId).length
  const ordered = phase === 'review' ? [...items.filter(issue), ...items.filter((item) => !issue(item))] : items
  const processing = phase === 'matching' || phase === 'processing'
  const completed = phase === 'matching' ? items.filter((item) => item.status !== 'matching').length : done + failed
  const step = phase === 'pick' ? 0 : phase === 'done' ? 2 : 1
  const title = phase === 'pick' ? captureView === 'camera' ? '답안 촬영' : captureView === 'review' ? '사진 확인' : kind === 'exam' ? '독해 사진 채점' : '단어 사진 채점'
    : phase === 'matching' ? '학생 이름을 읽고 있어요' : phase === 'review' ? '학생 확인'
      : phase === 'processing' ? kind === 'exam' ? '답안을 읽고 있어요' : '채점하고 있어요' : '처리 결과'
  const description = phase === 'pick' ? '학생당 한 장 · 이름과 답안 전체가 나오게 준비해주세요.'
    : phase === 'review' ? '사진과 학생이 맞는지 확인해주세요.'
      : phase === 'done' ? kind === 'exam' ? '답안 확인이 끝났습니다. 채점하고 저장하세요.' : '채점 결과가 저장되었습니다.'
        : '창을 닫지 말고 잠시 기다려주세요.'

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogContent showCloseButton={false} className={cn("top-0 left-0 h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 rounded-none border-0 bg-[var(--share-canvas)] p-0 text-[var(--share-ink)] shadow-none sm:top-1/2 sm:left-1/2 sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[20px]", phase === 'pick' && captureView === 'add' ? 'sm:h-[min(560px,90dvh)]' : 'sm:h-[min(820px,90dvh)]')}>
        <DialogHeader className="gap-3 border-b border-[var(--share-line)] px-4 py-4 text-left sm:px-6">
          <div className="flex items-center gap-2">
            {phase === 'review' && <Button type="button" variant="ghost" size="icon" aria-label="사진 확인으로 돌아가기" disabled={busy} onClick={onBack}><ArrowLeft className="size-5" /></Button>}
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-xl font-bold tracking-tight">{title}</DialogTitle>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="닫기" disabled={busy} onClick={onClose}><X className="size-5" /></Button>
          </div>
          <DialogDescription className="text-xs leading-relaxed text-[var(--share-muted)]">{description}</DialogDescription>
          <ol aria-label="답안 처리 단계" className="grid grid-cols-3 gap-2 text-[11px]">
            {['답안 추가', '학생 확인', '처리 결과'].map((label, index) => (
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
              {phase === 'review' && <div className="flex items-center justify-between text-sm"><span className="font-semibold">답안 {items.length}장</span><span className={needsCheck ? 'text-[var(--share-red)]' : 'text-[var(--share-muted)]'}>{needsCheck ? `확인 필요 ${needsCheck}장` : '모든 답안지의 학생을 확인했습니다'}</span></div>}
              {phase === 'done' && <div role="status" className="rounded-[20px] bg-[var(--share-card)] p-5"><p className="text-xl font-bold">{kind === 'exam' ? '답안 인식' : '채점 완료'} {done}명{failed > 0 ? ` · 실패 ${failed}건` : ''}</p>{failed > 0 && <p className="mt-2 text-sm">실패한 답안만 다시 시도하세요.</p>}</div>}
              <ul className="space-y-3" aria-label="학생별 답안">
                {ordered.map((item) => {
                  const index = items.findIndex((original) => original.id === item.id)
                  const duplicate = !!item.studentId && duplicateIds.has(item.studentId)
                  const confirmed = !!item.studentId && !duplicate && item.confirmedStudentId === item.studentId
                  const existing = students.find(student=>student.student_id===item.studentId)?.hasExisting
                  return <li key={item.id}><ExamStudentConfirmationCard number={index+1} previewUrl={item.previewUrl} mimeType={item.file.type}
                    studentId={item.studentId} students={students} rawName={item.rawName}
                    confirmed={confirmed} duplicate={duplicate} disabled={busy||item.status==='done'}
                    onStudentChange={studentId=>onSelect(item.id,studentId)} onConfirm={()=>onConfirmStudent(item.id)} onRemove={()=>onRemove(item.id)}>
                    {existing && <p className="text-xs text-[var(--share-muted)]">기존 답안을 새 결과로 반영합니다.{kind==='vocab' ? ' 교사 확정 답안은 유지됩니다.' : ''}</p>}
                    {item.message && <p role={item.status==='error'?'alert':undefined} className="break-words text-xs">{item.message}</p>}
                  </ExamStudentConfirmationCard></li>
                })}
              </ul>
            </div>
          </div>
        )}

        {phase !== 'pick' && <footer className="border-t border-[var(--share-line)] px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-6">
          <div className="mx-auto max-w-[520px] space-y-3">
            {phase === 'review' && <>
              {(duplicateIds.size > 0 || unmatched > 0) && <p className="text-xs text-[var(--share-muted)]">{duplicateIds.size > 0 ? `중복 학생 ${duplicateIds.size}명을 확인하세요.` : `미선택 ${unmatched}장의 학생을 선택하세요.`}</p>}
              <Button type="button" variant="action" disabled={busy || !canStart || readyCount === 0 || duplicateIds.size > 0} onClick={onStart} className="h-12 w-full rounded-xl">{readyCount}명 {kind === 'exam' ? '답안 인식' : '채점 시작'}</Button>
            </>}
            {processing && <p className="py-2 text-center text-sm text-[var(--share-muted)]">완료 {completed} / 전체 {items.length}장</p>}
            {continueError && <p role="alert" className="text-sm text-destructive">{continueError}</p>}
            {phase === 'done' && <div className="flex gap-2">
              {failed > 0 && <Button type="button" variant="action" disabled={busy || !canStart} onClick={onRetry} className="h-12 flex-1 rounded-xl">실패 {failed}건 재시도</Button>}
              {kind === 'exam' && onContinue && done > 0 && failed === 0
                ? <Button type="button" variant="action" disabled={busy || continueDisabled} onClick={onContinue} className="h-12 flex-1 rounded-xl">{continuing ? '채점·저장 중…' : continueDisabled ? '답안 저장 중…' : '채점하고 저장'}</Button>
                : <Button type="button" variant="outline" disabled={busy} onClick={onClose} className="h-12 flex-1 rounded-xl shadow-none">{kind === 'vocab' && !failed ? '성적표 보기' : '닫기'}</Button>}
            </div>}
          </div>
        </footer>}
      </DialogContent>
    </Dialog>
  )
}
