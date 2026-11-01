'use client'

import { useState, type ReactNode } from 'react'
import { Check, Expand, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ExamStudentConfirmationCard({ number, previewUrl, mimeType, studentId, students, rawName, confirmed, duplicate, disabled, onStudentChange, onConfirm, onRemove, children }: {
  number: number
  previewUrl: string
  mimeType: string
  studentId: string | null
  students: { student_id: string; student_name: string }[]
  rawName: string | null
  confirmed: boolean
  duplicate: boolean
  disabled: boolean
  onStudentChange: (studentId: string | null) => void
  onConfirm: () => void
  onRemove: () => void
  children?: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const selectId = `exam-student-${number}`
  const student = students.find((candidate) => candidate.student_id === studentId)
  const isPdf = mimeType === 'application/pdf'

  return (
    <article aria-label={`사진 ${number} 학생 확인`} className="overflow-hidden rounded-[20px] bg-[var(--share-card)] text-[var(--share-ink)]">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <p className="text-sm font-semibold">답안지 {String(number).padStart(2, '0')}</p>
        <span className={confirmed ? 'flex items-center gap-1 text-xs font-medium text-[var(--share-blue)]' : 'text-xs font-medium text-[var(--share-muted)]'}>
          {confirmed && <Check className="size-3.5" />}{confirmed ? '확인 완료' : '확인 대기'}
        </span>
      </div>

      <div className="mx-4 overflow-hidden rounded-xl bg-[var(--share-box)]">
        {isPdf ? (
          <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-32 items-center justify-center gap-2 px-4 text-sm text-[var(--share-blue)]">
            <Expand className="size-4" />답안지 열기
          </a>
        ) : (
          <button type="button" aria-label={`사진 ${number} ${expanded ? '이름란 확대' : '전체 보기'}`} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="relative block w-full overflow-hidden text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--share-blue)]">
            {expanded ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={`사진 ${number} 답안지 전체`} className="max-h-[60dvh] w-full object-contain" onError={() => setImageFailed(true)} />
            ) : (
              <div className="relative h-40 overflow-hidden sm:h-44">
                {/* 확대는 미리보기에만 적용한다. 업로드·판독 원본은 자르지 않는다. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt={`사진 ${number} 답안지 상단 이름란 확대`} className="absolute top-0 right-0 w-[150%] max-w-none" onError={() => setImageFailed(true)} />
              </div>
            )}
            <span className="absolute right-2 bottom-2 flex items-center gap-1 rounded-lg bg-[var(--share-canvas)] px-2 py-1 text-xs text-[var(--share-body)]"><Expand className="size-3" />{expanded ? '이름란 보기' : '전체 보기'}</span>
          </button>
        )}
      </div>

      <div className="space-y-3 p-4">
        {imageFailed && <p role="alert" className="text-xs text-[var(--share-red)]">사진을 불러오지 못했습니다. 사진을 다시 추가해 주세요.</p>}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-40 flex-1 space-y-1.5">
            <label htmlFor={selectId} className="text-xs font-medium text-[var(--share-body)]">학생</label>
            <select id={selectId} value={studentId ?? ''} disabled={disabled} onChange={(event) => onStudentChange(event.target.value || null)} className="h-11 w-full rounded-xl border border-[var(--share-line-strong)] bg-[var(--share-canvas)] px-3 text-base font-semibold text-[var(--share-ink)]">
              <option value="">학생 선택</option>
              {students.map((candidate) => <option key={candidate.student_id} value={candidate.student_id}>{candidate.student_name}</option>)}
            </select>
          </div>
          <Button type="button" variant={confirmed ? 'outline' : 'default'} className="h-11" disabled={disabled || !student || duplicate || imageFailed || confirmed} onClick={onConfirm} aria-label={`사진 ${number}: ${student?.student_name ?? '학생'} 학생 확인`}>
            {confirmed && <Check className="size-4" />}{confirmed ? '확인 완료' : '학생 확인'}
          </Button>
        </div>
        <p className="text-xs text-[var(--share-muted)]">{rawName ? `인식된 이름 · ${rawName}` : '이름을 인식하지 못했습니다. 학생을 선택해 주세요.'}</p>
        {duplicate && <p role="alert" className="text-xs text-[var(--share-red)]">다른 답안지에도 선택된 학생입니다. 학생을 다시 확인해 주세요.</p>}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 text-xs">{children}</div>
          {!disabled && <button type="button" aria-label={`사진 ${number} 제거`} onClick={onRemove} className="flex min-h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-xs text-[var(--share-muted)]"><Trash2 className="size-3.5" />답안지 제외</button>}
        </div>
      </div>
    </article>
  )
}
