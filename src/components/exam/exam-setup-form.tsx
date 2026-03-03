'use client'

import { Fragment, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useExamQuestions, useSaveExamQuestions, QuestionPayload } from '@/hooks/use-weeks'
import { useQuestionTypes } from '@/hooks/use-question-types'
import { useConceptCategories, useConceptTags } from '@/hooks/use-concept-tags'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface QuestionRow {
  question_number: number
  correct_answer: number
  question_type_id: string | null
  choices: { choice_number: number; concept_tag_id: string | null }[]
}

const ANSWER_NUMBERS = [1, 2, 3, 4, 5]

function makeDefaultChoices() {
  return ANSWER_NUMBERS.map((n) => ({ choice_number: n, concept_tag_id: null as string | null }))
}

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
  const { data: categories = [] } = useConceptCategories()
  const { data: allTags = [] } = useConceptTags()
  const saveQuestions = useSaveExamQuestions(weekId)

  const [count, setCount] = useState(4)
  const [rows, setRows] = useState<QuestionRow[]>([])
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!existing) return
    const reading = existing.filter((q) => q.exam_type === 'reading')
    if (reading.length > 0) {
      setCount(reading.length)
      setRows(reading.map((q) => ({
        question_number: q.question_number,
        correct_answer: q.correct_answer,
        question_type_id: q.question_type_id,
        choices: ANSWER_NUMBERS.map((n) => {
          const existing_choice = q.exam_question_choice?.find((c) => c.choice_number === n)
          return { choice_number: n, concept_tag_id: existing_choice?.concept_tag_id ?? null }
        }),
      })))
    } else {
      setRows(makeRows(4, null))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing])

  function makeRows(n: number, defaultTypeId: string | null): QuestionRow[] {
    return Array.from({ length: n }, (_, i) => ({
      question_number: i + 1,
      correct_answer: 1,
      question_type_id: defaultTypeId,
      choices: makeDefaultChoices(),
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
          choices: makeDefaultChoices(),
        }))
        return [...prev, ...extra]
      }
      return prev.slice(0, clamped)
    })
  }

  function updateRow(index: number, key: 'correct_answer' | 'question_type_id', value: string | number) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [key]: value } : r)))
  }

  function updateChoice(index: number, choiceNumber: number, tagId: string | null) {
    setRows((prev) =>
      prev.map((r, i) =>
        i !== index ? r : {
          ...r,
          choices: r.choices.map((c) =>
            c.choice_number === choiceNumber ? { ...c, concept_tag_id: tagId } : c
          ),
        }
      )
    )
  }

  function toggleExpand(index: number) {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function handleSave() {
    await saveQuestions.mutateAsync(
      rows.map((r): QuestionPayload => ({ ...r, exam_type: 'reading' as const }))
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
                <th className="px-3 py-2 text-left w-12">번호</th>
                <th className="px-3 py-2 text-left">문제 유형</th>
                <th className="px-3 py-2 text-left">정답</th>
                <th className="px-3 py-2 text-left w-24">선택지 태그</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row, i) => {
                const isExpanded = expandedRows.has(i)
                const hasTagsSet = row.choices.some((c) => c.concept_tag_id !== null)
                return (
                  <Fragment key={i}>
                    <tr className="hover:bg-gray-50">
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
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => toggleExpand(i)}
                          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
                        >
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          {hasTagsSet ? (
                            <span className="text-blue-600 font-medium">설정됨</span>
                          ) : '설정'}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-blue-50/40">
                        <td colSpan={4} className="px-4 py-3">
                          <div className="flex flex-wrap gap-3">
                            {ANSWER_NUMBERS.map((n) => (
                              <div key={n} className="flex items-center gap-1.5">
                                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-semibold
                                  ${row.correct_answer === n ? 'bg-primary text-white' : 'bg-gray-200 text-gray-600'}`}>
                                  {n}
                                </span>
                                <select
                                  value={row.choices.find((c) => c.choice_number === n)?.concept_tag_id ?? ''}
                                  onChange={(e) => updateChoice(i, n, e.target.value || null)}
                                  className="h-7 w-36 rounded border border-gray-200 px-1.5 text-xs focus:border-blue-400 focus:outline-none"
                                >
                                  <option value="">선택 안함</option>
                                  {categories.map((cat) => {
                                    const catTags = allTags.filter((t) => t.concept_category_id === cat.id)
                                    if (catTags.length === 0) return null
                                    return (
                                      <optgroup key={cat.id} label={cat.name}>
                                        {catTags.map((tag) => (
                                          <option key={tag.id} value={tag.id}>{tag.name}</option>
                                        ))}
                                      </optgroup>
                                    )
                                  })}
                                </select>
                              </div>
                            ))}
                          </div>
                          <p className="mt-1.5 text-xs text-gray-400">정답 선택지(파란색)에도 개념을 입력할 수 있어요</p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
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
