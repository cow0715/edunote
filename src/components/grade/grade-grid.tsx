'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CheckCircle2, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useGradeData, useSaveGrade, GradeRow } from '@/hooks/use-grade'
import { ExamQuestion } from '@/lib/types'
import { cn } from '@/lib/utils'

// ── 점수 토글 필드 ──────────────────────────────────────
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
    <div className="flex items-center gap-2 min-w-0">
      <Switch
        checked={active}
        disabled={disabled}
        onCheckedChange={(checked) => onChange(checked ? 0 : null)}
      />
      <span className="text-xs text-gray-400 shrink-0">{label}</span>
      {active ? (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={0}
            max={total}
            step={step ?? 1}
            value={value ?? 0}
            onChange={(e) => onChange(Number(e.target.value))}
            disabled={disabled}
            className="h-8 w-16 text-center text-sm"
          />
          <span className="text-xs text-gray-300">/{total}</span>
        </div>
      ) : (
        <span className="text-xs text-gray-300">{nullLabel}</span>
      )}
    </div>
  )
}

// ── 단어 사진 채점 버튼 ────────────────────────────────
type VocabResult = { number: number; english_word: string; student_answer: string; is_correct: boolean }

function VocabPhotoButton({ weekId, studentId, disabled, onResult }: {
  weekId: string
  studentId: string
  disabled: boolean
  onResult: (vocabCorrect: number, total: number, results: VocabResult[]) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setLoading(true)
    setError(null)
    try {
      const b64 = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.readAsDataURL(file)
      })
      const resp = await fetch(`/api/weeks/${weekId}/grade-vocab-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, fileData: b64, mimeType: file.type }),
      })
      const data = await resp.json()
      if (data.ok) {
        onResult(data.vocab_correct, data.vocab_total, data.results)
      } else {
        setError(data.error ?? '채점 실패')
      }
    } catch {
      setError('네트워크 오류')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFile} />
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => fileRef.current?.click()}
        className={cn(
          'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors shrink-0',
          disabled || loading ? 'text-gray-300 cursor-not-allowed' : 'text-indigo-500 hover:bg-indigo-50'
        )}
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
        {loading ? '채점 중...' : '사진 채점'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </>
  )
}

// ── 객관식 버튼 ────────────────────────────────────────
const ObjectiveInput = memo(function ObjectiveInput({
  value, onChange, disabled,
}: { value: number | null; onChange: (n: number | null) => void; disabled: boolean }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange(value === n ? null : n)}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors',
            value === n ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          )}
        >
          {n}
        </button>
      ))}
    </div>
  )
})

// ── OX 입력 ────────────────────────────────────────────
const OXInput = memo(function OXInput({
  textValue, onChange, disabled,
}: { textValue: string; onChange: (t: string) => void; disabled: boolean }) {
  const upper = textValue.trim().toUpperCase()
  const isO = upper === 'O'
  const isX = upper.startsWith('X')
  const currentCorr = isX ? textValue.trim().slice(1).trim() : ''
  const [rememberedCorr, setRememberedCorr] = useState(currentCorr)
  useEffect(() => {
    if (currentCorr) setRememberedCorr(currentCorr)
  }, [currentCorr])

  function selectO() { onChange('O') }
  function selectX() { onChange(rememberedCorr ? `X ${rememberedCorr}` : 'X') }
  function onCorrectionChange(v: string) {
    setRememberedCorr(v)
    onChange(v ? `X ${v}` : 'X')
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={isO ? () => onChange('') : selectO}
        className={cn(
          'flex h-8 w-10 items-center justify-center rounded-md text-sm font-bold transition-colors',
          isO ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
        )}
      >O</button>
      <button
        type="button"
        disabled={disabled}
        onClick={isX ? () => onChange('') : selectX}
        className={cn(
          'flex h-8 w-10 items-center justify-center rounded-md text-sm font-bold transition-colors',
          isX ? 'bg-rose-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
        )}
      >X</button>
      {isX && (
        <Input
          value={currentCorr}
          onChange={(e) => onCorrectionChange(e.target.value)}
          disabled={disabled}
          placeholder="수정어"
          className="h-8 w-28 text-sm"
        />
      )}
      {isO && rememberedCorr && (
        <span className="text-xs text-gray-300 truncate max-w-24">{rememberedCorr}</span>
      )}
    </div>
  )
})

// ── 문항 유형 배지 ─────────────────────────────────────
function StyleBadge({ style }: { style: ExamQuestion['question_style'] }) {
  const map = {
    objective:    { label: '객관식', cls: 'bg-gray-100 text-gray-500' },
    ox:           { label: 'O/X',   cls: 'bg-blue-50 text-blue-600' },
    subjective:   { label: '서술형', cls: 'bg-amber-50 text-amber-600' },
    multi_select: { label: '복수',  cls: 'bg-purple-50 text-purple-600' },
  }
  const { label, cls } = map[style] ?? { label: style, cls: 'bg-gray-100 text-gray-500' }
  return <span className={cn('inline-flex h-5 items-center rounded px-1.5 text-[10px] font-medium shrink-0', cls)}>{label}</span>
}

// ── 문항 행 ────────────────────────────────────────────
const QuestionRow = memo(function QuestionRow({
  q, answer, disabled, onChangeAnswer, onChangeText,
}: {
  q: ExamQuestion
  answer: { student_answer: number | null; student_answer_text?: string; is_correct?: boolean } | undefined
  disabled: boolean
  onChangeAnswer: (n: number | null) => void
  onChangeText: (t: string) => void
}) {
  const label = `${q.question_number}${q.sub_label ? ` (${q.sub_label})` : ''}`
  const isSubjective = q.question_style === 'subjective'
  const hasAnswer = (answer?.student_answer !== null && answer?.student_answer !== undefined) || !!answer?.student_answer_text
  const isWrong = hasAnswer && answer?.is_correct === false

  return (
    <div className={cn('px-4 py-3', isSubjective ? 'flex flex-col gap-2' : 'flex items-center gap-3')}>
      <div className="flex items-center gap-1.5 shrink-0 w-24">
        <span className={cn('text-sm font-medium', isWrong ? 'text-red-400 line-through' : 'text-gray-700')}>
          문제 {label}
        </span>
        <StyleBadge style={q.question_style} />
      </div>
      <div className="flex-1">
        {q.question_style === 'objective' && (
          <ObjectiveInput value={answer?.student_answer ?? null} onChange={onChangeAnswer} disabled={disabled} />
        )}
        {q.question_style === 'ox' && (() => {
          const savedText = answer?.student_answer_text?.trim() ?? ''
          const isAnsweredX = savedText.toUpperCase().startsWith('X')
          const enteredCorrection = isAnsweredX ? savedText.slice(1).trim() : ''
          return (
            <div className="flex flex-col gap-1.5">
              <OXInput textValue={savedText} onChange={onChangeText} disabled={disabled} />
              {savedText && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400 shrink-0">학생 답:</span>
                  <span className={cn(
                    'text-xs font-medium px-2 py-0.5 rounded-full shrink-0',
                    answer?.is_correct ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-500'
                  )}>
                    {isAnsweredX ? `X${enteredCorrection ? ` → ${enteredCorrection}` : ''}` : savedText}
                    {' '}{answer?.is_correct ? '✓' : '✗'}
                  </span>
                </div>
              )}
            </div>
          )
        })()}
        {q.question_style === 'multi_select' && (
          <Input
            value={answer?.student_answer_text ?? ''}
            onChange={(e) => onChangeText(e.target.value)}
            disabled={disabled}
            placeholder={`예: ${q.correct_answer_text ?? '1,3'}`}
            className="h-8 w-36 text-sm"
          />
        )}
        {q.question_style === 'subjective' && (
          <Textarea
            value={answer?.student_answer_text ?? ''}
            onChange={(e) => onChangeText(e.target.value)}
            disabled={disabled}
            placeholder="답안 입력"
            rows={2}
            className="text-sm resize-none"
          />
        )}
      </div>
      {!isSubjective && q.correct_answer_text && (
        <span className="text-xs text-gray-300 shrink-0">정답: {q.correct_answer_text}</span>
      )}
    </div>
  )
})

// ── 단어 Sheet 내용 ────────────────────────────────────
type VocabAnswerRow = { id: string; number: number; english_word: string; student_answer: string | null; is_correct: boolean }

function VocabSheetContent({ row, weekId, vocabTotal, vocabAnswers, updateRow }: {
  row: GradeRow
  weekId: string
  vocabTotal: number
  vocabAnswers: VocabAnswerRow[]
  updateRow: (studentId: string, key: keyof GradeRow, value: unknown) => void
}) {
  const queryClient = useQueryClient()
  const [editableVocab, setEditableVocab] = useState<VocabAnswerRow[]>(vocabAnswers)
  useEffect(() => { setEditableVocab(vocabAnswers) }, [vocabAnswers])

  async function saveVocabAnswer(id: string, student_answer: string, is_correct: boolean) {
    await fetch('/api/vocab-answer', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, student_answer, is_correct }),
    })
  }

  const half = Math.ceil(editableVocab.length / 2)
  const cols = [editableVocab.slice(0, half), editableVocab.slice(half)]

  return (
    <div className="space-y-4 p-4">
      {/* 점수 + 사진 채점 */}
      <div className="flex items-center gap-3 flex-wrap">
        <ScoreToggleField
          label="단어"
          total={vocabTotal}
          value={row.vocab_correct}
          nullLabel="미응시"
          disabled={!row.present}
          onChange={(v) => updateRow(row.student_id, 'vocab_correct', v)}
        />
        <VocabPhotoButton
          weekId={weekId}
          studentId={row.student_id}
          disabled={!row.present}
          onResult={(correct, _total, _results) => {
            updateRow(row.student_id, 'vocab_correct', correct)
            queryClient.refetchQueries({ queryKey: ['grade', weekId] })
          }}
        />
      </div>

      {/* 정오표 */}
      {editableVocab.length > 0 ? (
        <div>
          <p className="text-xs text-gray-400 mb-2">
            <span className="text-green-600 font-medium">{editableVocab.filter((a) => a.is_correct).length}정</span>
            &nbsp;/&nbsp;
            <span className="text-red-400 font-medium">{editableVocab.filter((a) => !a.is_correct).length}오</span>
            &nbsp;/ {editableVocab.length}개
          </p>
          <div className="flex gap-6">
            {cols.map((col, ci) => (
              <div key={ci} className="flex-1 space-y-1.5 min-w-0">
                {col.map((a) => (
                  <div key={a.number} className="flex items-center gap-1 text-xs min-w-0">
                    <span className="text-gray-300 w-5 shrink-0 text-right">{a.number}.</span>
                    <span className="font-mono text-gray-600 shrink-0 w-20 truncate">{a.english_word}</span>
                    <span className="text-gray-300 shrink-0">→</span>
                    <input
                      className="flex-1 min-w-0 border-b border-gray-200 bg-transparent text-xs outline-none focus:border-indigo-400 px-0.5"
                      value={a.student_answer ?? ''}
                      onChange={(e) => {
                        const val = e.target.value
                        setEditableVocab((prev) => prev.map((x) => x.id === a.id ? { ...x, student_answer: val } : x))
                      }}
                      onBlur={(e) => saveVocabAnswer(a.id, e.target.value, a.is_correct)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const next = !a.is_correct
                        setEditableVocab((prev) => prev.map((x) => x.id === a.id ? { ...x, is_correct: next } : x))
                        saveVocabAnswer(a.id, a.student_answer ?? '', next)
                      }}
                      className={cn('shrink-0 w-5 text-center font-bold', a.is_correct ? 'text-green-500' : 'text-red-400')}
                    >
                      {a.is_correct ? '✓' : '✗'}
                    </button>
                  </div>
                ))}
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

// ── 시험 Sheet 내용 ────────────────────────────────────
function ExamSheetContent({ row, questions, readingTotal, updateRow, updateAnswer, updateAnswerText }: {
  row: GradeRow
  questions: ExamQuestion[]
  readingTotal: number
  updateRow: (studentId: string, key: keyof GradeRow, value: unknown) => void
  updateAnswer: (studentId: string, questionId: string, value: number | null) => void
  updateAnswerText: (studentId: string, questionId: string, text: string) => void
}) {
  const hasSubjective = questions.some((q) => q.question_style === 'subjective')
  const disabled = !row.present || !row.reading_present

  return (
    <div>
      {/* 미응시 토글 */}
      {(questions.length > 0 || readingTotal > 0) && (
        <div className="flex items-center gap-2 px-4 py-3 border-b bg-gray-50/50">
          <Switch
            checked={row.reading_present}
            disabled={!row.present}
            onCheckedChange={(checked) => updateRow(row.student_id, 'reading_present', checked)}
          />
          <span className="text-xs text-gray-500">
            {row.reading_present ? '응시' : '미응시'}
          </span>
        </div>
      )}

      {/* 진단평가 직접 입력 (문항 없는 경우) */}
      {readingTotal > 0 && questions.length === 0 && row.reading_present && (
        <div className="px-4 py-3">
          <ScoreToggleField
            label="진단평가"
            total={readingTotal}
            value={row.reading_correct}
            nullLabel="미입력"
            disabled={!row.present}
            onChange={(v) => updateRow(row.student_id, 'reading_correct', v)}
          />
        </div>
      )}

      {questions.length === 0 && readingTotal === 0 && (
        <p className="px-4 py-6 text-xs text-gray-400 text-center">
          설정 → 해설지 탭에서 PDF를 올리면 문항이 표시됩니다.
        </p>
      )}

      {questions.length > 0 && (
        <div className={cn('divide-y', !row.reading_present && 'opacity-40 pointer-events-none')}>
          {questions.map((q) => {
            const answer = row.answers.find((a) => a.exam_question_id === q.id)
            return (
              <QuestionRow
                key={q.id}
                q={q}
                answer={answer}
                disabled={disabled}
                onChangeAnswer={(n) => updateAnswer(row.student_id, q.id, n)}
                onChangeText={(t) => updateAnswerText(row.student_id, q.id, t)}
              />
            )
          })}
        </div>
      )}

      {hasSubjective && row.reading_present && (
        <p className="px-4 py-2 text-xs text-amber-600 border-t bg-amber-50/50">
          서술형(AI 채점) 문항은 저장 시 자동 채점됩니다
        </p>
      )}
    </div>
  )
}

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
  const [rows, setRows] = useState<GradeRow[]>([])
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [aiGradingFailed, setAiGradingFailed] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sheetView, setSheetView] = useState<{ type: 'vocab' | 'exam'; studentIndex: number } | null>(null)

  useEffect(() => {
    if (!data) return
    const { classStudents, weekScores, questions } = data

    type SavedAnswer = {
      exam_question_id: string
      student_answer: number | null
      student_answer_text: string | null
      ox_selection: string | null
      is_correct: boolean
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
              ai_feedback: saved?.ai_feedback ?? '',
            }
          }),
        }
      })
    )
  }, [data])

  // 단어 답안 맵
  const vocabAnswerMap = (() => {
    const m = new Map<string, VocabAnswerRow[]>()
    if (!data?.weekScores) return m
    for (const score of data.weekScores) {
      const answers: VocabAnswerRow[] = (
        (score.student_vocab_answer ?? []) as {
          id: string
          student_answer: string | null
          is_correct: boolean
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
        }))
        .sort((a, b) => a.number - b.number)
      m.set(score.student_id, answers)
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
      <div className="rounded-xl border bg-white overflow-hidden">
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

      {/* 슬라이드 Sheet */}
      <Sheet open={sheetView !== null} onOpenChange={(open) => { if (!open) setSheetView(null) }}>
        <SheetContent
          showCloseButton={false}
          className="w-[500px] sm:max-w-[500px] p-0 gap-0 overflow-y-auto"
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
                  vocabTotal={vocabTotal}
                  vocabAnswers={vocabAnswerMap.get(sheetRow.student_id) ?? []}
                  updateRow={updateRow}
                />
              )}
              {sheetView.type === 'exam' && (
                <ExamSheetContent
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
