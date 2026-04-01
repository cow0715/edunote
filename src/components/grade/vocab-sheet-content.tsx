'use client'

import { useEffect, useState } from 'react'
import { Camera, X, Lock } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { GradeRow } from '@/hooks/use-grade'
import { cn } from '@/lib/utils'
import { VocabPhotoButton } from './vocab-photo-button'

export type VocabAnswerRow = { id: string; number: number; english_word: string; student_answer: string | null; is_correct: boolean; teacher_locked: boolean }

export function VocabSheetContent({ row, weekId, weekScoreId, vocabAnswers, vocabPhotoPath, updateRow }: {
  row: GradeRow
  weekId: string
  weekScoreId: string
  vocabAnswers: VocabAnswerRow[]
  vocabPhotoPath: string | null
  updateRow: (studentId: string, key: keyof GradeRow, value: unknown) => void
}) {
  const queryClient = useQueryClient()
  const [editableVocab, setEditableVocab] = useState<VocabAnswerRow[]>(vocabAnswers)
  const [regrading, setRegrading] = useState(false)
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoOpen, setPhotoOpen] = useState(false)
  useEffect(() => { setEditableVocab(vocabAnswers); setDirtyIds(new Set()) }, [vocabAnswers])

  useEffect(() => {
    if (!vocabPhotoPath) { setPhotoUrl(null); return }
    fetch(`/api/vocab-photo-url?path=${encodeURIComponent(vocabPhotoPath)}`)
      .then((r) => r.json())
      .then((d) => { if (d.url) setPhotoUrl(d.url) })
      .catch(() => {})
  }, [vocabPhotoPath])

  async function saveVocabAnswer(id: string, student_answer: string, is_correct: boolean, teacher_locked?: boolean) {
    await fetch('/api/vocab-answer', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, week_score_id: weekScoreId, student_answer, is_correct, teacher_locked }),
    })
  }

  async function regrade() {
    setRegrading(true)
    try {
      // teacher_locked 항목은 AI 재채점에서 제외
      const itemsToRegrade = editableVocab.filter((a) => dirtyIds.has(a.id) && !a.teacher_locked)
      if (itemsToRegrade.length === 0) { setDirtyIds(new Set()); return }

      const resp = await fetch('/api/vocab-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekScoreId,
          items: itemsToRegrade.map((a) => ({ id: a.id, number: a.number, english_word: a.english_word, student_answer: a.student_answer })),
        }),
      })
      const data = await resp.json()
      if (data.ok) {
        await queryClient.refetchQueries({ queryKey: ['grade', weekId] })
        setDirtyIds(new Set())
      }
    } finally {
      setRegrading(false)
    }
  }

  return (
    <div className="space-y-4 p-4">
      {/* 사진 채점 */}
      <div className="flex items-center gap-3 flex-wrap">
        <VocabPhotoButton
          weekId={weekId}
          studentId={row.student_id}
          disabled={!row.present}
          onResult={(correct, _total, _results) => {
            updateRow(row.student_id, 'vocab_correct', correct)
            queryClient.refetchQueries({ queryKey: ['grade', weekId] })
          }}
        />
        {photoUrl && (
          <button
            type="button"
            onClick={() => setPhotoOpen(true)}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <Camera className="h-3 w-3" />
            원본 사진
          </button>
        )}
      </div>

      {/* 사진 전체보기 오버레이 */}
      {photoOpen && photoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setPhotoOpen(false)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <img src={photoUrl} alt="단어 시험지" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain" />
            <button
              onClick={() => setPhotoOpen(false)}
              className="absolute -top-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full bg-white shadow text-gray-600 hover:bg-gray-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* 정오표 */}
      {editableVocab.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-400">
              <span className="text-green-600 font-medium">{editableVocab.filter((a) => a.is_correct).length}정</span>
              &nbsp;/&nbsp;
              <span className="text-red-400 font-medium">{editableVocab.filter((a) => !a.is_correct).length}오</span>
              &nbsp;/ {editableVocab.length}개
            </p>
            {(() => {
              const regradeCount = editableVocab.filter((a) => dirtyIds.has(a.id) && !a.teacher_locked).length
              return regradeCount > 0 ? (
                <button
                  type="button"
                  onClick={regrade}
                  disabled={regrading}
                  className="text-[11px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50 font-medium"
                >
                  {regrading ? '채점 중…' : `재채점 (${regradeCount}개)`}
                </button>
              ) : null
            })()}
          </div>
          <div className="columns-1 sm:columns-2 gap-x-4">
            {editableVocab.map((a) => (
              <div key={a.number} className={cn(
                'flex items-center gap-1 text-xs min-w-0 py-0.5 break-inside-avoid rounded px-0.5',
                a.teacher_locked ? 'bg-blue-50' : dirtyIds.has(a.id) ? 'bg-amber-50' : ''
              )}>
                <span className="text-gray-300 w-5 shrink-0 text-right">{a.number}.</span>
                <span className="font-mono text-gray-600 shrink-0 w-24 truncate">{a.english_word}</span>
                <span className="text-gray-300 shrink-0">→</span>
                <input
                  className="flex-1 min-w-0 border-b border-gray-200 bg-transparent text-xs outline-none focus:border-indigo-400 px-0.5"
                  value={a.student_answer ?? ''}
                  onChange={(e) => {
                    const val = e.target.value
                    // 텍스트 수정 시 teacher_locked 해제
                    setEditableVocab((prev) => prev.map((x) => x.id === a.id ? { ...x, student_answer: val, teacher_locked: false } : x))
                    setDirtyIds((prev) => new Set(prev).add(a.id))
                  }}
                />
                {a.teacher_locked && (
                  <Lock className="shrink-0 h-2.5 w-2.5 text-blue-400" />
                )}
                <button
                  type="button"
                  title={a.teacher_locked ? '교사 확정 (클릭해서 해제)' : '클릭해서 정오 전환 (교사 확정)'}
                  onClick={() => {
                    const next = !a.is_correct
                    const locked = !a.teacher_locked  // 첫 클릭: 잠금, 잠긴 상태 재클릭: 해제 + 토글
                    const updated = editableVocab.map((x) => x.id === a.id ? { ...x, is_correct: next, teacher_locked: locked } : x)
                    setEditableVocab(updated)
                    saveVocabAnswer(a.id, a.student_answer ?? '', next, locked)
                    updateRow(row.student_id, 'vocab_correct', updated.filter((x) => x.is_correct).length)
                  }}
                  className={cn('shrink-0 w-5 text-center font-bold', a.is_correct ? 'text-green-500' : 'text-red-400')}
                >
                  {a.is_correct ? '✓' : '✗'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-400">사진 채점 후 단어 정오표가 표시됩니다.</p>
      )}
    </div>
  )
}
