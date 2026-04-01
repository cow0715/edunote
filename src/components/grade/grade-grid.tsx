'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useGradeData, useSaveGrade, useSaveWeekScore, GradeRow } from '@/hooks/use-grade'
import { ExamQuestion } from '@/lib/types'
import { cn } from '@/lib/utils'
import { VocabSheetContent, VocabAnswerRow } from './vocab-sheet-content'
import { ExamSheetContent } from './exam-sheet-content'
import { SubjectiveReviewPanel } from './subjective-review-panel'

// ── 메인 컴포넌트 ──────────────────────────────────────
interface Props {
  weekId: string
  vocabTotal: number
  readingTotal: number
  homeworkTotal: number
  onSaved?: () => void
}

export function GradeGrid({ weekId, vocabTotal, readingTotal, homeworkTotal, onSaved }: Props) {
  const { data, isLoading } = useGradeData(weekId)
  const saveGrade = useSaveGrade(weekId)
  const saveWeekScore = useSaveWeekScore(weekId)
  const [rows, setRows] = useState<GradeRow[]>([])
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [aiGradingFailed, setAiGradingFailed] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sheetView, setSheetView] = useState<{ type: 'vocab' | 'exam'; studentIndex: number } | null>(null)
  const [showReviewPanel, setShowReviewPanel] = useState(false)

  useEffect(() => {
    if (!data) return
    const { classStudents, weekScores, questions } = data

    type SavedAnswer = {
      exam_question_id: string
      student_answer: number | null
      student_answer_text: string | null
      ox_selection: string | null
      is_correct: boolean
      needs_review: boolean
      teacher_confirmed: boolean
      ai_feedback: string | null
    }
    type SavedVocabAnswer = {
      vocab_word_id: string
      student_answer: string | null
      is_correct: boolean
      vocab_word: { number: number; english_word: string } | null
    }
    type ScoreRecord = {
      student_id: string
      id: string
      vocab_correct: number | null
      reading_correct: number | null
      homework_done: number | null
      memo: string | null
      vocab_photo_path: string | null
      student_answer: SavedAnswer[]
      student_vocab_answer: SavedVocabAnswer[]
    }

    const scoreMap = new Map<string, ScoreRecord>(
      weekScores?.map((s: ScoreRecord) => [s.student_id, s])
    )
    const hasAnyScore = (weekScores?.length ?? 0) > 0
    const attendanceMap = new Map<string, string>(
      ((data.attendance ?? []) as { student_id: string; status: string }[]).map((a) => [a.student_id, a.status])
    )

    setRows(
      (classStudents ?? []).map((cs: { student_id: string; student: { name: string } }) => {
        const score = scoreMap.get(cs.student_id)
        const attStatus = attendanceMap.get(cs.student_id)
        const present = attStatus === 'absent' ? false : (hasAnyScore ? !!score : true)
        return {
          student_id: cs.student_id,
          student_name: cs.student?.name ?? '',
          present,
          vocab_correct: score?.vocab_correct ?? null,
          reading_present: score ? score.reading_correct !== null : true,
          reading_correct: score?.reading_correct ?? null,
          homework_done: score?.homework_done ?? null,
          memo: score?.memo ?? '',
          answers: (questions ?? []).map((q: ExamQuestion) => {
            const saved = score?.student_answer?.find((a) => a.exam_question_id === q.id)
            let answerText = ''
            if (q.question_style === 'ox' && saved) {
              if (saved.ox_selection === 'O') answerText = 'O'
              else if (saved.ox_selection === 'X') answerText = saved.student_answer_text ? `X ${saved.student_answer_text}` : 'X'
            } else {
              answerText = saved?.student_answer_text ?? ''
            }
            return {
              exam_question_id: q.id,
              student_answer: saved?.student_answer ?? null,
              student_answer_text: answerText,
              is_correct: saved?.is_correct,
              needs_review: saved?.needs_review,
              teacher_confirmed: saved?.teacher_confirmed,
              ai_feedback: saved?.ai_feedback ?? '',
            }
          }),
        }
      })
    )
  }, [data])

  // 단어 답안 맵 (data 변경 시에만 재계산)
  const vocabAnswerMap = useMemo(() => {
    const m = new Map<string, VocabAnswerRow[]>()
    if (!data?.weekScores) return m
    for (const score of data.weekScores) {
      const answers: VocabAnswerRow[] = (
        (score.student_vocab_answer ?? []) as {
          id: string
          student_answer: string | null
          is_correct: boolean
          teacher_locked: boolean
          vocab_word: { number: number; english_word: string } | null
        }[]
      )
        .filter((a) => a.vocab_word)
        .map((a) => ({
          id: a.id,
          number: a.vocab_word!.number,
          english_word: a.vocab_word!.english_word,
          student_answer: a.student_answer,
          is_correct: a.is_correct,
          teacher_locked: a.teacher_locked ?? false,
        }))
        .sort((a, b) => a.number - b.number)
      m.set(score.student_id, answers)
    }
    return m
  }, [data?.weekScores])

  const weekScoreIdMap = (() => {
    const m = new Map<string, string>()
    for (const score of data?.weekScores ?? []) m.set(score.student_id, score.id)
    return m
  })()

  const vocabPhotoPathMap = (() => {
    const m = new Map<string, string>()
    for (const score of data?.weekScores ?? []) {
      if (score.vocab_photo_path) m.set(score.student_id, score.vocab_photo_path)
    }
    return m
  })()

  const updateRow = useCallback((studentId: string, key: keyof GradeRow, value: unknown) => {
    setRows((prev) => prev.map((r) => (r.student_id === studentId ? { ...r, [key]: value } : r)))
  }, [])

  const updateAnswer = useCallback((studentId: string, questionId: string, value: number | null) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.student_id !== studentId) return r
        return { ...r, answers: r.answers.map((a) => a.exam_question_id === questionId ? { ...a, student_answer: value } : a) }
      })
    )
  }, [])

  const updateAnswerText = useCallback((studentId: string, questionId: string, text: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.student_id !== studentId) return r
        return {
          ...r, answers: r.answers.map((a) =>
            a.exam_question_id === questionId
              ? { ...a, student_answer_text: text, teacher_confirmed: false }
              : a
          ),
        }
      })
    )
  }, [])

  if (isLoading) return <div className="h-40 animate-pulse rounded-lg bg-gray-100" />

  const questions: ExamQuestion[] = data?.questions ?? []
  const students = data?.classStudents ?? []

  if (students.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">수강 학생이 없어요. 먼저 학생을 배정해주세요.</p>
  }

  const hasSubjective = questions.some((q) => q.question_style === 'subjective')
  const sheetRow = sheetView !== null ? rows[sheetView.studentIndex] ?? null : null
  const showVocab = vocabTotal > 0
  const showExam = readingTotal > 0 || questions.length > 0

  function navigateSheet(delta: number) {
    if (!sheetView) return
    const next = sheetView.studentIndex + delta
    if (next >= 0 && next < rows.length) {
      setSheetView({ ...sheetView, studentIndex: next })
    }
  }

  return (
    <div className="space-y-3">
      {questions.length === 0 && (
        <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
          진단평가 채점 칸은 설정 → 해설지 탭에서 PDF를 올리면 자동으로 생성됩니다.
        </p>
      )}

      {/* 테이블 */}
      <div className="relative rounded-xl border bg-white overflow-hidden">
        {saveGrade.isPending && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/75">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-500" />
              {hasSubjective ? 'AI 채점 중...' : '저장 중...'}
            </div>
          </div>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50/80">
              <th className="w-10 px-3 py-2.5 text-center text-xs font-medium text-gray-400">출결</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-400">학생</th>
              {showVocab && <th className="w-24 px-3 py-2.5 text-center text-xs font-medium text-gray-400">단어</th>}
              {showExam && <th className="w-24 px-3 py-2.5 text-center text-xs font-medium text-gray-400">시험</th>}
              {homeworkTotal > 0 && <th className="w-36 px-3 py-2.5 text-center text-xs font-medium text-gray-400">숙제</th>}
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-400">메모</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row, idx) => (
              <tr key={row.student_id} className={cn('transition-colors hover:bg-gray-50/40', !row.present && 'opacity-40')}>
                {/* 출결 */}
                <td className="px-3 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={row.present}
                    onChange={(e) => updateRow(row.student_id, 'present', e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 accent-primary"
                  />
                </td>

                {/* 학생명 */}
                <td className="px-3 py-3 font-medium text-gray-900 whitespace-nowrap">{row.student_name}</td>

                {/* 단어 셀 */}
                {showVocab && (
                  <td className="px-3 py-3 text-center">
                    <button
                      type="button"
                      disabled={!row.present}
                      onClick={() => setSheetView({ type: 'vocab', studentIndex: idx })}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                        !row.present
                          ? 'text-gray-300 cursor-not-allowed'
                          : row.vocab_correct !== null
                            ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                      )}
                    >
                      {row.vocab_correct !== null ? `${row.vocab_correct}/${vocabTotal}` : '—'}
                    </button>
                  </td>
                )}

                {/* 시험 셀 */}
                {showExam && (
                  <td className="px-3 py-3 text-center">
                    <button
                      type="button"
                      disabled={!row.present}
                      onClick={() => setSheetView({ type: 'exam', studentIndex: idx })}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                        !row.present
                          ? 'text-gray-300 cursor-not-allowed'
                          : row.reading_correct !== null
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                      )}
                    >
                      {row.reading_correct !== null
                        ? `${row.reading_correct}/${readingTotal > 0 ? readingTotal : questions.length}`
                        : '—'}
                    </button>
                  </td>
                )}

                {/* 숙제 */}
                {homeworkTotal > 0 && (
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-center gap-1">
                      {row.homework_done !== null ? (
                        <>
                          <input
                            type="number"
                            min={0}
                            max={homeworkTotal}
                            step={0.5}
                            value={row.homework_done}
                            onChange={(e) => updateRow(row.student_id, 'homework_done', Number(e.target.value))}
                            onBlur={(e) => saveWeekScore.mutate({ student_id: row.student_id, homework_done: Number(e.target.value), memo: row.memo })}
                            disabled={!row.present}
                            className="w-12 h-7 text-center text-xs border border-gray-200 rounded-md bg-white disabled:bg-gray-50 disabled:text-gray-300 outline-none focus:border-indigo-400"
                          />
                          <span className="text-xs text-gray-300">/{homeworkTotal}</span>
                          <button
                            type="button"
                            onClick={() => updateRow(row.student_id, 'homework_done', null)}
                            disabled={!row.present}
                            className="text-gray-300 hover:text-gray-500 disabled:cursor-not-allowed"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => updateRow(row.student_id, 'homework_done', 0)}
                          disabled={!row.present}
                          className="text-xs text-gray-300 hover:text-gray-500 disabled:cursor-not-allowed"
                        >
                          미제출
                        </button>
                      )}
                    </div>
                  </td>
                )}

                {/* 메모 */}
                <td className="px-3 py-3">
                  <input
                    value={row.memo}
                    onChange={(e) => updateRow(row.student_id, 'memo', e.target.value)}
                    onBlur={(e) => saveWeekScore.mutate({ student_id: row.student_id, homework_done: row.homework_done, memo: e.target.value })}
                    disabled={!row.present}
                    placeholder="메모"
                    className="w-full text-xs h-7 bg-transparent outline-none placeholder:text-gray-300 text-gray-700 disabled:cursor-not-allowed"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 저장 버튼 영역 */}
      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-gray-400">
          채점 {rows.filter((r) => r.present).length} / 전체 {rows.length}명
          {hasSubjective && ' · 서술형 포함'}
        </p>
        <div className="flex items-center gap-3">
          {hasSubjective && (() => {
            const needsReviewCount = rows.reduce(
              (n, r) => n + r.answers.filter((a) => a.needs_review).length, 0
            )
            return (
              <button
                type="button"
                onClick={() => setShowReviewPanel((v) => !v)}
                className={cn(
                  'flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors',
                  showReviewPanel
                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                )}
              >
                서술형 검토
                {needsReviewCount > 0 && (
                  <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {needsReviewCount}
                  </span>
                )}
              </button>
            )
          })()}
          {aiGradingFailed && (
            <span className="text-xs text-amber-600">AI 채점 실패 — 데이터는 저장됨</span>
          )}
          {savedAt && !aiGradingFailed && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              저장됨 ({savedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })})
            </span>
          )}
          <Button
            onClick={() => {
              setAiGradingFailed(false)
              saveGrade.mutate(rows, {
                onSuccess: (result) => {
                  if (result?.ai_grading_failed) {
                    setAiGradingFailed(true)
                    const now = new Date()
                    setSavedAt(now)
                    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
                    savedTimerRef.current = setTimeout(() => setSavedAt(null), 10000)
                  } else {
                    onSaved?.()
                  }
                },
              })
            }}
            disabled={saveGrade.isPending}
          >
            {saveGrade.isPending ? (hasSubjective ? 'AI 채점 중...' : '저장 중...') : '채점 저장'}
          </Button>
        </div>
      </div>

      {/* 서술형 검토 패널 */}
      {showReviewPanel && hasSubjective && (
        <div className="rounded-xl border bg-white p-4">
          <SubjectiveReviewPanel
            weekId={weekId}
            questions={questions}
            rows={rows}
          />
        </div>
      )}

      {/* 슬라이드 Sheet */}
      <Sheet open={sheetView !== null} onOpenChange={(open) => { if (!open) { setSheetView(null); saveGrade.mutate(rows, { onSuccess: () => {}, onError: () => {} }) } }}>
        <SheetContent
          showCloseButton={false}
          className="w-full sm:w-[600px] sm:max-w-[600px] p-0 gap-0 overflow-y-auto"
        >
          {sheetRow && sheetView && (
            <>
              {/* 헤더: 학생명 + 이전/다음 */}
              <SheetHeader className="flex-row items-center justify-between px-4 py-3 border-b sticky top-0 bg-white z-10 gap-0">
                <div className="flex items-center gap-2">
                  <SheetTitle className="text-base font-semibold">{sheetRow.student_name}</SheetTitle>
                  <span className="text-xs text-gray-400">{sheetView.studentIndex + 1}/{rows.length}</span>
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded-full font-medium',
                    sheetView.type === 'vocab' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'
                  )}>
                    {sheetView.type === 'vocab' ? '단어' : '시험'}
                  </span>
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => navigateSheet(-1)}
                    disabled={sheetView.studentIndex === 0}
                    className="rounded p-1.5 hover:bg-gray-100 disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateSheet(1)}
                    disabled={sheetView.studentIndex === rows.length - 1}
                    className="rounded p-1.5 hover:bg-gray-100 disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSheetView(null)}
                    className="rounded p-1.5 hover:bg-gray-100 transition-colors ml-1"
                  >
                    <X className="h-4 w-4 text-gray-400" />
                  </button>
                </div>
              </SheetHeader>

              {sheetView.type === 'vocab' && (
                <VocabSheetContent
                  row={sheetRow}
                  weekId={weekId}
                  weekScoreId={weekScoreIdMap.get(sheetRow.student_id) ?? ''}
                  vocabAnswers={vocabAnswerMap.get(sheetRow.student_id) ?? []}
                  vocabPhotoPath={vocabPhotoPathMap.get(sheetRow.student_id) ?? null}
                  updateRow={updateRow}
                />
              )}
              {sheetView.type === 'exam' && (
                <ExamSheetContent
                  weekId={weekId}
                  row={sheetRow}
                  questions={questions}
                  readingTotal={readingTotal}
                  updateRow={updateRow}
                  updateAnswer={updateAnswer}
                  updateAnswerText={updateAnswerText}
                />
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
