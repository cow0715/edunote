'use client'

import { AnswerPhotoDialog } from './answer-photo-dialog'
import { useCaptureRuntime } from './capture-runtime'

import { useEffect, useState } from 'react'
import { Camera, Lock } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { runWithLoading } from '@/lib/async-ui'
import { GradeRow } from '@/hooks/use-grade'
import { cn } from '@/lib/utils'
import { ExampleSentenceInline, EXAMPLE_LABEL, isExampleSourceValue } from './vocab-example-inline'
import { gradeChoiceAnswer } from '@/lib/vocab-blank-grading'

import { createGradeSaveQueue, type GradeSaveQueue, type GradeSaveResult, type GradeVersion } from '@/lib/atomic-grade'

export type VocabAnswerRow = { id: string; number: number; source_number?: number; english_word: string; test_word?: string | null; test_source?: string | null; test_prompt?: string | null; test_answer?: string | null; student_answer: string | null; is_correct: boolean; teacher_locked: boolean }

export function VocabSheetContent({ row, weekId, weekScoreId, vocabAnswers, vocabPhotoPath, updateRow, saveQueue, onVersionsSaved }: {
  saveQueue?: GradeSaveQueue
  onVersionsSaved?: () => void
  row: GradeRow
  weekId: string
  weekScoreId: string
  vocabAnswers: VocabAnswerRow[]
  vocabPhotoPath: string | null
  updateRow: (studentId: string, key: keyof GradeRow, value: unknown) => void
}) {
  const { request } = useCaptureRuntime()
  const [localQueue] = useState(createGradeSaveQueue)
  const queue = saveQueue ?? localQueue
  const queryClient = useQueryClient()
  const { mutateAsync: queueWrite } = useMutation({
    scope: { id: `week-score:${weekId}` },
    mutationFn: (write: () => Promise<GradeSaveResult>) => write(),
  })
  const [editableVocab, setEditableVocab] = useState<VocabAnswerRow[]>(vocabAnswers)
  const [regrading, setRegrading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())
  const [editVersion, setEditVersion] = useState<GradeVersion | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoOpen, setPhotoOpen] = useState(false)

  // 서버 답안이 갱신되면 편집본을 맞추고 dirty 표시를 지운다 — 렌더 중 조정
  const [syncedVocabAnswers, setSyncedVocabAnswers] = useState(vocabAnswers)
  if (syncedVocabAnswers !== vocabAnswers) {
    setSyncedVocabAnswers(vocabAnswers)
    setEditableVocab(vocabAnswers.map((answer) => dirtyIds.has(answer.id)
      ? editableVocab.find((local) => local.id === answer.id) ?? answer : answer))
  }

  // 사진 경로가 바뀌면 이전 서명 URL 을 즉시 지운다 — 렌더 중 조정 (다른 학생 사진이 잠깐 남는 것 방지)
  const [syncedPhotoPath, setSyncedPhotoPath] = useState(vocabPhotoPath)
  if (syncedPhotoPath !== vocabPhotoPath) {
    setSyncedPhotoPath(vocabPhotoPath)
    setPhotoUrl(null)
  }
  useEffect(() => {
    if (!vocabPhotoPath) return
    // fetch 후(then 안) setState — 렌더 중 동기 호출이 아니라 규칙에 걸리지 않는다
    request(`/api/vocab-photo-url?path=${encodeURIComponent(vocabPhotoPath)}`)
      .then((r) => r.json())
      .then((d) => { if (d.url) setPhotoUrl(d.url) })
      .catch(() => {})
  }, [vocabPhotoPath, request])

  async function persist(method: string, body: Record<string, unknown>) {
    return queueWrite(() => queue.run([{ ...row, grade_version: editVersion ?? row.grade_version }], async ([submitted]) => {
      const response = await request('/api/vocab-answer', {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, grade_version: submitted.grade_version }),
      })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result.error ?? '답안을 저장하지 못했습니다.')
      return result as GradeSaveResult
    })).then((result) => { onVersionsSaved?.(); return result })
  }

  async function saveVocabAnswer(id: string, student_answer: string, is_correct: boolean, teacher_locked?: boolean) {
    setSaving(true)
    try {
      await persist('PATCH', { id, student_answer, is_correct, teacher_locked })
      return true
    } catch {
      toast.error('답안을 저장하지 못했습니다. 편집 내용은 유지됩니다.')
      return false
    } finally { setSaving(false) }
  }

  async function saveTextOnly(a: VocabAnswerRow, value: string) {
    if (!dirtyIds.has(a.id)) return
    await saveVocabAnswer(a.id, value, a.is_correct, false)
  }

  async function regrade() {
    await runWithLoading(setRegrading, async () => {
      const items = editableVocab.filter((a) => dirtyIds.has(a.id) && !a.teacher_locked)
      if (!items.length) return
      await persist('POST', { weekScoreId, items: items.map((a) => ({ id: a.id, number: a.number,
        english_word: a.test_word ?? a.english_word, student_answer: a.student_answer })) })
      setDirtyIds((prev) => new Set([...prev].filter((id) => !items.some((a) => a.id === id))))
      setEditVersion(null)
      await queryClient.refetchQueries({ queryKey: ['grade', weekId] })
    }, () => toast.error('재채점하지 못했습니다. 편집 내용은 유지됩니다.'))
  }

  return (
    <div className="space-y-4 p-4">
      {/* 사진 채점 */}
      <div className="flex items-center gap-3 flex-wrap">
        {photoUrl && (
          <button
            type="button"
            onClick={() => setPhotoOpen(true)}
            className="flex items-center gap-1 min-h-11 rounded-xl border px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <Camera className="h-3 w-3" />
            원본 사진 보기
          </button>
        )}
      </div>

      {/* 사진 전체보기 오버레이 */}
      <AnswerPhotoDialog open={photoOpen} onOpenChange={setPhotoOpen} url={photoUrl} title="단어 시험지 원본 사진" />

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
                  disabled={regrading || saving}
                  className="text-[11px] px-2 py-0.5 rounded bg-[var(--share-blue-bg)] text-[var(--share-blue)] hover:bg-[var(--share-blue-bg)] disabled:opacity-50 font-medium"
                >
                  {regrading ? '채점 중…' : `재채점 (${regradeCount}개)`}
                </button>
              ) : null
            })()}
          </div>
          {/* 시험지와 같은 순서로 배치: 뜻쓰기(2단) → 예문 파트(전폭 1단). 강사가 종이와 대조하기 쉽게 */}
          {(() => {
            const meaningRows = editableVocab.filter((a) => !isExampleSourceValue(a.test_source))
            const exampleParts = (['example_meaning', 'example', 'example_choice'] as const)
              .map((source) => ({ source, rows: editableVocab.filter((a) => a.test_source === source) }))
              .filter((part) => part.rows.length > 0)
            const showPartLabels = exampleParts.length > 0 && meaningRows.length > 0

            const renderAnswerControls = (a: VocabAnswerRow, inputClass: string) => (
              <>
                <input
                  className={cn(
                    'min-w-0 border-b border-gray-200 bg-transparent text-base sm:text-sm outline-none focus:border-[var(--share-blue)] px-0.5',
                    // 정오에 맞춰 학생 답 텍스트 색 — ✓✗ 아이콘만으로는 훑기 느림
                    a.is_correct ? 'text-emerald-700' : 'text-rose-500',
                    inputClass,
                  )}
                  disabled={regrading}
                  value={a.student_answer ?? ''}
                  onChange={(e) => {
                    if (!dirtyIds.size) setEditVersion(queue.resolve(row.grade_version))
                    const val = e.target.value
                    setEditableVocab((prev) => prev.map((x) => x.id === a.id ? { ...x, student_answer: val, teacher_locked: false } : x))
                    setDirtyIds((prev) => new Set(prev).add(a.id))
                  }}
                  onBlur={(e) => {
                    // blur 시 텍스트 즉시 저장 (is_correct는 재채점 버튼으로 별도 업데이트)
                    saveTextOnly(a, e.target.value)
                  }}
                />
                {a.teacher_locked && (
                  <Lock className="shrink-0 h-2.5 w-2.5 text-blue-400" />
                )}
                <button
                  type="button"
                  disabled={regrading || saving}
                  title={a.teacher_locked ? '교사 확정 (클릭해서 해제)' : '클릭해서 정오 전환 (교사 확정)'}
                  onClick={async () => {
                    if (!dirtyIds.size) setEditVersion(queue.resolve(row.grade_version))
                    const next = !a.is_correct
                    const locked = !a.teacher_locked
                    const updated = editableVocab.map((x) => x.id === a.id ? { ...x, is_correct: next, teacher_locked: locked } : x)
                    setEditableVocab(updated)
                    setDirtyIds((prev) => new Set(prev).add(a.id))
                    if (await saveVocabAnswer(a.id, a.student_answer ?? '', next, locked)) {
                      setDirtyIds((prev) => { const ids = new Set(prev); ids.delete(a.id); return ids })
                      if (!dirtyIds.size || (dirtyIds.size === 1 && dirtyIds.has(a.id))) setEditVersion(null)
                      await queue.idle()
                      await queryClient.refetchQueries({ queryKey: ['grade', weekId] })
                    }
                  }}
                  className={cn('shrink-0 w-5 text-center font-bold', a.is_correct ? 'text-green-500' : 'text-red-400')}
                >
                  {a.is_correct ? '✓' : '✗'}
                </button>
              </>
            )

            const rowBg = (a: VocabAnswerRow) => a.teacher_locked ? 'bg-blue-50' : dirtyIds.has(a.id) ? 'bg-muted' : ''

            return (
              <div className="space-y-3">
                {meaningRows.length > 0 && (
                  <div>
                    {showPartLabels && <p className="mb-1 text-[11px] font-bold text-gray-500">뜻쓰기 <span className="font-normal text-gray-400">{meaningRows.length}문항</span></p>}
                    <div className="columns-1 sm:columns-2 gap-x-4">
                      {meaningRows.map((a) => (
                        <div key={a.id} className={cn('flex items-center gap-1 text-sm min-w-0 py-2 break-inside-avoid rounded px-0.5', rowBg(a))}>
                          <span className="text-gray-300 w-5 shrink-0 text-right">{a.number}.</span>
                          <span className="font-mono text-gray-600 w-28 shrink-0 break-words whitespace-normal">{a.test_word ?? a.english_word}</span>
                          <span className="text-gray-300 shrink-0">→</span>
                          {renderAnswerControls(a, 'flex-1')}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {exampleParts.map((part) => (
                  <div key={part.source} className={showPartLabels ? 'border-t border-gray-100 pt-2' : ''}>
                    <p className="mb-1 text-[11px] font-bold text-gray-500">
                      {EXAMPLE_LABEL[part.source].long} <span className="font-normal text-gray-400">{part.rows.length}문항 · {EXAMPLE_LABEL[part.source].hint}</span>
                    </p>
                    <div className="space-y-0.5">
                      {part.rows.map((a) => {
                        // 선택형은 학생이 시험지에서 한 동작(동그라미)을 문장 안에 그대로 그린다.
                        // 문장엔 정답, 옆칸엔 학생 답이라 서로 다른 걸 보여주던 게 헷갈렸다.
                        const isChoice = part.source === 'example_choice' && !!a.test_prompt
                        return (
                        <div key={a.id} className={cn('flex items-center gap-1 text-sm min-w-0 py-2 rounded px-0.5', rowBg(a))}>
                          <span className="text-gray-300 w-5 shrink-0 text-right">{a.number}.</span>
                          {/* 예문 파트: 시험지 문장이 메인, 학생 답 입력칸은 오른쪽 고정폭 */}
                          <div className="min-w-0 flex-1">
                            {a.test_prompt ? (
                              <ExampleSentenceInline
                                source={part.source}
                                promptText={a.test_prompt}
                                answer={a.test_answer}
                                studentAnswer={a.student_answer}
                                isCorrect={a.is_correct}
                                size="xs"
                                onPickOption={isChoice ? (option) => {
                                  // 선택형은 코드로 결정적 채점 — 클릭 즉시 정오 반영 (LLM 재채점 불필요)
                                  const next = gradeChoiceAnswer(option, a.test_answer)
                                  const updated = editableVocab.map((x) => x.id === a.id
                                    ? { ...x, student_answer: option, is_correct: next, teacher_locked: false }
                                    : x)
                                  setEditableVocab(updated)
                                  setDirtyIds((prev) => { const s = new Set(prev); s.delete(a.id); return s })
                                  saveVocabAnswer(a.id, option, next, false)
                                  updateRow(row.student_id, 'vocab_correct', updated.filter((x) => x.is_correct).length)
                                } : undefined}
                              />
                            ) : (
                              <span className="font-mono text-gray-600">{a.test_word ?? a.english_word}</span>
                            )}
                          </div>
                          {isChoice ? (
                            // 미응답은 동그라미가 없어 상태가 안 보이므로 표식만 남긴다
                            !a.student_answer?.trim()
                              ? <span className="shrink-0 text-[10px] text-gray-300">미응답</span>
                              : <span className={cn('shrink-0 w-5 text-center font-bold', a.is_correct ? 'text-green-500' : 'text-red-400')}>
                                  {a.is_correct ? '✓' : '✗'}
                                </span>
                          ) : (
                            <>
                              <span className="text-gray-300 shrink-0">→</span>
                              {renderAnswerControls(a, 'w-28 shrink-0')}
                            </>
                          )}
                        </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      ) : (
        <p className="text-xs text-gray-400">사진 채점 후 단어 정오표가 표시됩니다.</p>
      )}
    </div>
  )
}
