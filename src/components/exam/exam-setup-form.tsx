'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useExamQuestions, useSaveExamQuestions } from '@/hooks/use-weeks'
import { useQuestionTypes } from '@/hooks/use-question-types'

interface QuestionRow {
  question_number: number
  correct_answer: number
  question_type_id: string | null
}

const ANSWER_NUMBERS = [1, 2, 3, 4, 5]

function AnswerButtons({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {ANSWER_NUMBERS.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`flex h-7 w-7 items-center justify-center rounded text-xs font-semibold transition-colors
            ${value === n ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

export function ExamSetupForm({ weekId }: { weekId: string }) {
  const { data: existing, isLoading } = useExamQuestions(weekId)
  const { data: questionTypes = [] } = useQuestionTypes()
  const saveQuestions = useSaveExamQuestions(weekId)

  const [count, setCount] = useState(4)
  const [rows, setRows] = useState<QuestionRow[]>([])

  useEffect(() => {
    if (!existing) return
    const reading = existing.filter((q) => q.exam_type === 'reading')
    if (reading.length > 0) {
      setCount(reading.length)
      setRows(reading.map((q) => ({
        question_number: q.question_number,
        correct_answer: q.correct_answer,
        question_type_id: q.question_type_id,
      })))
    } else {
      setRows(makeRows(4, questionTypes[0]?.id ?? null))
    }
  }, [existing, questionTypes])

  function makeRows(n: number, defaultTypeId: string | null): QuestionRow[] {
    return Array.from({ length: n }, (_, i) => ({
      question_number: i + 1,
      correct_answer: 1,
      question_type_id: defaultTypeId,
    }))
  }

  function handleCountChange(n: number) {
    const clamped = Math.max(0, Math.min(20, n))
    setCount(clamped)
    setRows((prev) => {
      if (clamped > prev.length) {
        const extra = Array.from({ length: clamped - prev.length }, (_, i) => ({
          question_number: prev.length + i + 1,
          correct_answer: 1,
          question_type_id: questionTypes[0]?.id ?? null,
        }))
        return [...prev, ...extra]
      }
      return prev.slice(0, clamped)
    })
  }

  function updateRow(index: number, key: 'correct_answer' | 'question_type_id', value: string | number) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [key]: value } : r)))
  }

  async function handleSave() {
    await saveQuestions.mutateAsync(
      rows.map((r) => ({ ...r, exam_type: 'reading' as const }))
    )
  }

  if (isLoading) return <div className="h-40 animate-pulse rounded-lg bg-gray-100" />

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label htmlFor="count" className="whitespace-nowrap">문항 수</Label>
        <Input
          id="count"
          type="number"
          min={0}
          max={20}
          value={count}
          onChange={(e) => handleCountChange(Number(e.target.value))}
          className="w-24"
        />
        <span className="text-sm text-gray-400">문항</span>
      </div>

      {rows.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left w-16">번호</th>
                <th className="px-3 py-2 text-left">문제 유형</th>
                <th className="px-3 py-2 text-left">정답</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-500">{row.question_number}</td>
                  <td className="px-3 py-2">
                    <Select
                      value={row.question_type_id ?? ''}
                      onValueChange={(v) => updateRow(i, 'question_type_id', v)}
                    >
                      <SelectTrigger className="h-8 w-full">
                        <SelectValue placeholder="유형 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {questionTypes.map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <AnswerButtons
                      value={row.correct_answer}
                      onChange={(n) => updateRow(i, 'correct_answer', n)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saveQuestions.isPending}>
          {saveQuestions.isPending ? '저장 중...' : '저장'}
        </Button>
      </div>
    </div>
  )
}
