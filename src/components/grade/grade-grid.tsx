'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { useGradeData, useSaveGrade, GradeRow } from '@/hooks/use-grade'
import { ExamQuestion } from '@/lib/types'

// ── 점수 토글 필드 ────────────────────────────────────────────────────────
function ScoreToggleField({ label, total, value, nullLabel, disabled, step, onChange }: {
  label: string
  total: number
  value: number | null
  nullLabel: string
  disabled: boolean
  step?: number
  onChange: (v: number | null) => void
}) {
  const active = value !== null
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-gray-400">{label} <span className="text-gray-300">/{total}</span></p>
      <div className="flex items-center gap-2">
        <Switch
          checked={active}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked ? 0 : null)}
        />
        {active ? (
          <Input
            type="number"
            min={0}
            max={total}
            step={step ?? 1}
            value={value ?? 0}
            onChange={(e) => onChange(Number(e.target.value))}
            disabled={disabled}
            className="h-8 w-20 text-center"
          />
        ) : (
          <span className="text-xs text-gray-400">{nullLabel}</span>
        )}
      </div>
    </div>
  )
}

// ── 객관식 셀 ─────────────────────────────────────────────────────────────
const AnswerCell = memo(function AnswerCell({ value, onChange }: { value: number | null; onChange: (n: number | null) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(value === n ? null : n)}
          className={`flex h-7 w-7 items-center justify-center rounded text-xs font-semibold transition-colors
            ${value === n ? 'bg-primary text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
        >
          {n}
        </button>
      ))}
    </div>
  )
})

// ── 학생 카드 ──────────────────────────────────────────────────────────────
const StudentCard = memo(function StudentCard({
  row,
  questions,
  vocabTotal,
  readingTotal,
  homeworkTotal,
  updateRow,
  updateAnswer,
  updateAnswerText,
}: {
  row: GradeRow
  questions: ExamQuestion[]
  vocabTotal: number
  readingTotal: number
  homeworkTotal: number
  updateRow: (studentId: string, key: keyof GradeRow, value: unknown) => void
  updateAnswer: (studentId: string, questionId: string, value: number | null) => void
  updateAnswerText: (studentId: string, questionId: string, text: string) => void
}) {
  const [open, setOpen] = useState(true)
  const hasSubjective = questions.some((q) => q.question_style === 'subjective')
  const hasTextAnswer = questions.some((q) => ['subjective', 'ox', 'multi_select'].includes(q.question_style))

  return (
    <div className={`rounded-xl border bg-white transition-opacity ${!row.present ? 'opacity-50' : ''}`}>
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-4 py-3">
        <input
          type="checkbox"
          checked={row.present}
          onChange={(e) => updateRow(row.student_id, 'present', e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 accent-primary"
          title="채점 포함"
        />
        <span className="flex-1 font-medium text-gray-900">{row.student_name}</span>
        <button onClick={() => setOpen((v) => !v)} className="text-gray-400 hover:text-gray-600">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {open && (
        <div className="border-t px-4 py-3 space-y-4">
          {/* 단어 + 진단평가 + 숙제 */}
          <div className="flex gap-6">
            {vocabTotal > 0 && (
              <ScoreToggleField
                label="단어"
                total={vocabTotal}
                value={row.vocab_correct}
                nullLabel="미응시"
                disabled={!row.present}
                onChange={(v) => updateRow(row.student_id, 'vocab_correct', v)}
              />
            )}
            {readingTotal > 0 && questions.length === 0 && (
              <ScoreToggleField
                label="진단평가"
                total={readingTotal}
                value={row.reading_correct}
                nullLabel="미응시"
                disabled={!row.present}
                onChange={(v) => updateRow(row.student_id, 'reading_correct', v)}
              />
            )}
            {homeworkTotal > 0 && (
              <ScoreToggleField
                label="숙제"
                total={homeworkTotal}
                step={0.5}
                value={row.homework_done}
                nullLabel="미제출"
                disabled={!row.present}
                onChange={(v) => updateRow(row.student_id, 'homework_done', v)}
              />
            )}
            <div className="flex-1 space-y-1">
              <p className="text-xs text-gray-400">메모</p>
              <Input
                value={row.memo}
                onChange={(e) => updateRow(row.student_id, 'memo', e.target.value)}
                disabled={!row.present}
                placeholder="특이사항"
                className="h-8"
              />
            </div>
          </div>

          {/* 진단평가 문항 */}
          {questions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500">진단평가</p>

              {/* 문항 순서대로 */}
              <div className="flex flex-wrap gap-x-4 gap-y-3">
                {questions.map((q) => {
                  const a = row.answers.find((a) => a.exam_question_id === q.id)
                  const styleLabel =
                    q.question_style === 'ox' ? { text: 'O/X', cls: 'bg-blue-50 text-blue-700' }
                    : q.question_style === 'multi_select' ? { text: '복수정답', cls: 'bg-orange-50 text-orange-700' }
                    : q.question_style === 'subjective' ? { text: '서술형', cls: 'bg-amber-50 text-amber-700' }
                    : null
                  const placeholder =
                    q.question_style === 'ox' ? 'O / X (수정어)'
                    : q.question_style === 'multi_select' ? `예: ${q.correct_answer_text ?? '1,3'}`
                    : '답안'

                  return (
                    <div key={q.id} className="space-y-1">
                      <p className="text-xs text-gray-400 flex items-center gap-1">
                        {styleLabel && (
                          <span className={`rounded px-1 py-0.5 ${styleLabel.cls}`}>{styleLabel.text}</span>
                        )}
                        {(() => {
                          const ans = row.answers.find((a) => a.exam_question_id === q.id)
                          const hasAnswer = ans?.student_answer !== null || !!ans?.student_answer_text
                          const wrong = hasAnswer && ans?.is_correct === false
                          return (
                            <span className={wrong ? 'text-red-400 line-through' : ''}>
                              문제 {q.question_number}{q.sub_label ? ` (${q.sub_label})` : ''}
                            </span>
                          )
                        })()}
                        {q.correct_answer_text && q.question_style !== 'subjective' && (
                          <span className="text-gray-300">({q.correct_answer_text})</span>
                        )}
                      </p>
                      {q.question_style === 'objective' ? (
                        <AnswerCell
                          value={a?.student_answer ?? null}
                          onChange={(n) => updateAnswer(row.student_id, q.id, n)}
                        />
                      ) : q.question_style === 'subjective' ? (
                        <Textarea
                          value={a?.student_answer_text ?? ''}
                          onChange={(e) => updateAnswerText(row.student_id, q.id, e.target.value)}
                          disabled={!row.present}
                          placeholder={placeholder}
                          rows={2}
                          className="text-sm resize-none w-64"
                        />
                      ) : (
                        <Input
                          value={a?.student_answer_text ?? ''}
                          onChange={(e) => updateAnswerText(row.student_id, q.id, e.target.value)}
                          disabled={!row.present}
                          placeholder={placeholder}
                          className="h-8 w-32 text-sm"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {hasSubjective && (
            <p className="text-xs text-amber-600">서술형(AI채점) 문항은 저장 시 자동 채점됩니다</p>
          )}
          {hasTextAnswer && !hasSubjective && (
            <p className="text-xs text-blue-500">단답형·복수정답은 저장 시 자동 채점됩니다</p>
          )}
        </div>
      )}
    </div>
  )
})

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────
interface Props {
  weekId: string
  vocabTotal: number
  readingTotal: number
  homeworkTotal: number
}

export function GradeGrid({ weekId, vocabTotal, readingTotal, homeworkTotal }: Props) {
  const { data, isLoading } = useGradeData(weekId)
  const saveGrade = useSaveGrade(weekId)
  const [rows, setRows] = useState<GradeRow[]>([])
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [aiGradingFailed, setAiGradingFailed] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!data) return
    const { classStudents, weekScores, questions } = data

    type SavedAnswer = {
      exam_question_id: string
      student_answer: number | null
      student_answer_text: string | null
      is_correct: boolean
      ai_feedback: string | null
    }
    type ScoreRecord = {
      student_id: string
      id: string
      vocab_correct: number | null
      reading_correct: number | null
      homework_done: number | null
      memo: string | null
      student_answer: SavedAnswer[]
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
          reading_correct: score?.reading_correct ?? null,
          homework_done: score?.homework_done ?? null,
          memo: score?.memo ?? '',
          answers: (questions ?? []).map((q: ExamQuestion) => {
            const saved = score?.student_answer?.find((a) => a.exam_question_id === q.id)
            return {
              exam_question_id: q.id,
              student_answer: saved?.student_answer ?? null,
              student_answer_text: saved?.student_answer_text ?? '',
              is_correct: saved?.is_correct,
              ai_feedback: saved?.ai_feedback ?? '',
            }
          }),
        }
      })
    )
  }, [data])

  const updateRow = useCallback((studentId: string, key: keyof GradeRow, value: unknown) => {
    setRows((prev) =>
      prev.map((r) => (r.student_id === studentId ? { ...r, [key]: value } : r))
    )
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
        return { ...r, answers: r.answers.map((a) => a.exam_question_id === questionId ? { ...a, student_answer_text: text } : a) }
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

  return (
    <div className="space-y-3">
      {questions.length === 0 && (
        <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
          진단평가 채점 칸은 설정 → 해설지 탭에서 PDF를 올리면 자동으로 생성됩니다.
        </p>
      )}

      {rows.map((row) => (
        <StudentCard
          key={row.student_id}
          row={row}
          questions={questions}
          vocabTotal={vocabTotal}
          homeworkTotal={homeworkTotal}
          readingTotal={readingTotal}
          updateRow={updateRow}
          updateAnswer={updateAnswer}
          updateAnswerText={updateAnswerText}
        />
      ))}

      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-gray-400">
          채점 {rows.filter((r) => r.present).length} / 전체 {rows.length}명
          {hasSubjective && ' · 서술형 포함'}
        </p>
        <div className="flex items-center gap-3">
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
                  if (result?.ai_grading_failed) setAiGradingFailed(true)
                  const now = new Date()
                  setSavedAt(now)
                  if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
                  savedTimerRef.current = setTimeout(() => setSavedAt(null), 10000)
                },
              })
            }}
            disabled={saveGrade.isPending}
          >
            {saveGrade.isPending
              ? (hasSubjective ? 'AI 채점 중...' : '저장 중...')
              : '채점 저장'}
          </Button>
        </div>
      </div>
    </div>
  )
}
