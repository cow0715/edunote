'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useGradeData, useSaveGrade, GradeRow } from '@/hooks/use-grade'
import { ExamQuestion } from '@/lib/types'

// ── 객관식 셀 ─────────────────────────────────────────────────────────────
function AnswerCell({ value, onChange }: { value: number | null; onChange: (n: number | null) => void }) {
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
}

// ── 학생 카드 ──────────────────────────────────────────────────────────────
function StudentCard({
  row,
  questions,
  vocabTotal,
  homeworkTotal,
  onChange,
  onAnswerChange,
  onAnswerTextChange,
}: {
  row: GradeRow
  questions: ExamQuestion[]
  vocabTotal: number
  homeworkTotal: number
  onChange: (key: keyof GradeRow, value: unknown) => void
  onAnswerChange: (questionId: string, value: number | null) => void
  onAnswerTextChange: (questionId: string, text: string) => void
}) {
  const [open, setOpen] = useState(true)
  const hasSubjective = questions.some((q) => q.question_style === 'subjective')

  return (
    <div className={`rounded-xl border bg-white transition-opacity ${!row.present ? 'opacity-50' : ''}`}>
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-4 py-3">
        <input
          type="checkbox"
          checked={row.present}
          onChange={(e) => onChange('present', e.target.checked)}
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
          {/* 단어 + 숙제 */}
          <div className="flex gap-6">
            {vocabTotal > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-gray-400">단어 <span className="text-gray-300">/{vocabTotal}</span></p>
                <Input
                  type="number"
                  min={0}
                  max={vocabTotal}
                  value={row.vocab_correct}
                  onChange={(e) => onChange('vocab_correct', Number(e.target.value))}
                  disabled={!row.present}
                  className="h-8 w-20 text-center"
                />
              </div>
            )}
            {homeworkTotal > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-gray-400">숙제 <span className="text-gray-300">/{homeworkTotal}</span></p>
                <Input
                  type="number"
                  min={0}
                  max={homeworkTotal}
                  value={row.homework_done}
                  onChange={(e) => onChange('homework_done', Number(e.target.value))}
                  disabled={!row.present}
                  className="h-8 w-20 text-center"
                />
              </div>
            )}
            <div className="flex-1 space-y-1">
              <p className="text-xs text-gray-400">메모</p>
              <Input
                value={row.memo}
                onChange={(e) => onChange('memo', e.target.value)}
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

              {/* 객관식 모아서 한 줄 */}
              {questions.filter((q) => q.question_style !== 'subjective').length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {questions
                    .filter((q) => q.question_style !== 'subjective')
                    .map((q) => {
                      const a = row.answers.find((a) => a.exam_question_id === q.id)
                      return (
                        <div key={q.id} className="space-y-1">
                          <p className="text-xs text-gray-400">
                            {q.concept_tag?.concept_category?.name ?? '문항'} {q.question_number}번
                          </p>
                          <AnswerCell
                            value={a?.student_answer ?? null}
                            onChange={(n) => onAnswerChange(q.id, n)}
                          />
                        </div>
                      )
                    })}
                </div>
              )}

              {/* 서술형 세로 */}
              {questions
                .filter((q) => q.question_style === 'subjective')
                .map((q) => {
                  const a = row.answers.find((a) => a.exam_question_id === q.id)
                  return (
                    <div key={q.id} className="space-y-1">
                      <p className="text-xs text-gray-400">
                        <span className="mr-1.5 rounded bg-amber-100 px-1 py-0.5 text-amber-700">서술</span>
                        {q.concept_tag?.concept_category?.name ?? '문항'} {q.question_number}번
                        {q.correct_answer_text && (
                          <span className="ml-2 text-gray-300">모범답안: {q.correct_answer_text}</span>
                        )}
                      </p>
                      <Textarea
                        value={a?.student_answer_text ?? ''}
                        onChange={(e) => onAnswerTextChange(q.id, e.target.value)}
                        disabled={!row.present}
                        placeholder="학생 답안 입력"
                        rows={2}
                        className="text-sm resize-none"
                      />
                    </div>
                  )
                })}
            </div>
          )}

          {hasSubjective && (
            <p className="text-xs text-amber-600">서술형은 저장 시 AI가 자동 채점합니다</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────
interface Props {
  weekId: string
  vocabTotal: number
  homeworkTotal: number
}

export function GradeGrid({ weekId, vocabTotal, homeworkTotal }: Props) {
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
      vocab_correct: number
      homework_done: number
      memo: string | null
      student_answer: SavedAnswer[]
    }

    const scoreMap = new Map<string, ScoreRecord>(
      weekScores?.map((s: ScoreRecord) => [s.student_id, s])
    )

    setRows(
      (classStudents ?? []).map((cs: { student_id: string; student: { name: string } }) => {
        const score = scoreMap.get(cs.student_id)
        return {
          student_id: cs.student_id,
          student_name: cs.student?.name ?? '',
          present: true,                    // 기본값 true (채점 포함)
          vocab_correct: score?.vocab_correct ?? 0,
          homework_done: score?.homework_done ?? 0,
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

  function updateRow(studentId: string, key: keyof GradeRow, value: unknown) {
    setRows((prev) =>
      prev.map((r) => (r.student_id === studentId ? { ...r, [key]: value } : r))
    )
  }

  function updateAnswer(studentId: string, questionId: string, value: number | null) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.student_id !== studentId) return r
        return { ...r, answers: r.answers.map((a) => a.exam_question_id === questionId ? { ...a, student_answer: value } : a) }
      })
    )
  }

  function updateAnswerText(studentId: string, questionId: string, text: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.student_id !== studentId) return r
        return { ...r, answers: r.answers.map((a) => a.exam_question_id === questionId ? { ...a, student_answer_text: text } : a) }
      })
    )
  }

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
          onChange={(key, value) => updateRow(row.student_id, key, value)}
          onAnswerChange={(qId, value) => updateAnswer(row.student_id, qId, value)}
          onAnswerTextChange={(qId, text) => updateAnswerText(row.student_id, qId, text)}
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
