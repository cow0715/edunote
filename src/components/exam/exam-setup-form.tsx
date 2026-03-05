'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useExamQuestions, useSaveExamQuestions, QuestionPayload } from '@/hooks/use-weeks'
import { useConceptCategories, useConceptTags } from '@/hooks/use-concept-tags'
import { toast } from 'sonner'

interface QuestionRow {
  question_number: number
  correct_answer: number
  concept_category_id: string | null
  concept_tag_id: string | null
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
  const { data: categories = [] } = useConceptCategories()
  const { data: allTags = [] } = useConceptTags()
  const saveQuestions = useSaveExamQuestions(weekId)

  const [count, setCount] = useState(4)
  const [rows, setRows] = useState<QuestionRow[]>([])
  const initialized = useRef(false)

  useEffect(() => {
    if (!existing || initialized.current) return
    initialized.current = true
    const reading = existing.filter((q) => q.exam_type === 'reading')
    if (reading.length > 0) {
      setCount(reading.length)
      setRows(reading.map((q) => {
        const conceptTagId = q.concept_tag_id ?? null
        const tag = allTags.find((t) => t.id === conceptTagId)
        return {
          question_number: q.question_number,
          correct_answer: q.correct_answer,
          concept_category_id: tag?.concept_category_id ?? null,
          concept_tag_id: conceptTagId,
        }
      }))
    } else {
      setRows(makeRows(4))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, allTags])

  function makeRows(n: number): QuestionRow[] {
    return Array.from({ length: n }, (_, i) => ({
      question_number: i + 1,
      correct_answer: 1,
      concept_category_id: null,
      concept_tag_id: null,
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
          concept_category_id: null,
          concept_tag_id: null,
        }))
        return [...prev, ...extra]
      }
      return prev.slice(0, clamped)
    })
  }

  function updateCategory(index: number, catId: string) {
    setRows((prev) => prev.map((r, i) =>
      i !== index ? r : { ...r, concept_category_id: catId || null, concept_tag_id: null }
    ))
  }

  function updateConceptTag(index: number, tagId: string) {
    setRows((prev) => prev.map((r, i) =>
      i !== index ? r : { ...r, concept_tag_id: tagId || null }
    ))
  }

  function updateCorrectAnswer(index: number, value: number) {
    setRows((prev) => prev.map((r, i) => i === index ? { ...r, correct_answer: value } : r))
  }

  async function handleSave() {
    const missing = rows.filter((r) => !r.concept_category_id).map((r) => r.question_number)
    if (missing.length > 0) {
      toast.error(`대분류를 선택해주세요 (${missing.join(', ')}번)`)
      return
    }
    await saveQuestions.mutateAsync(
      rows.map((r): QuestionPayload => ({
        question_number: r.question_number,
        correct_answer: r.correct_answer,
        question_type_id: null,
        concept_tag_id: r.concept_tag_id,
        exam_type: 'reading',
        choices: [],
      }))
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
          <div className="overflow-y-auto max-h-[420px]">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 sticky top-0 z-10 border-b">
                <tr>
                  <th className="px-3 py-2.5 text-left w-10 font-medium">#</th>
                  <th className="px-3 py-2.5 text-left font-medium">대분류</th>
                  <th className="px-3 py-2.5 text-left font-medium">소분류</th>
                  <th className="px-3 py-2.5 text-left font-medium">정답</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row, i) => {
                  const catTags = allTags.filter((t) => t.concept_category_id === row.concept_category_id)
                  return (
                    <tr key={i} className="hover:bg-gray-50/70">
                      <td className="px-3 py-2 w-10 text-gray-400 text-xs">{row.question_number}</td>
                      <td className="px-3 py-2">
                        <Select
                          value={row.concept_category_id ?? ''}
                          onValueChange={(v) => updateCategory(i, v)}
                        >
                          <SelectTrigger className="h-8 w-full text-xs">
                            <SelectValue placeholder="대분류 선택" />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={row.concept_tag_id ?? ''}
                          onValueChange={(v) => updateConceptTag(i, v)}
                          disabled={!row.concept_category_id}
                        >
                          <SelectTrigger className="h-8 w-full text-xs" disabled={!row.concept_category_id}>
                            <SelectValue placeholder={
                              !row.concept_category_id ? '대분류 먼저' :
                              catTags.length === 0 ? '소분류 없음' : '소분류 선택'
                            } />
                          </SelectTrigger>
                          <SelectContent>
                            {catTags.map((t) => (
                              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <AnswerButtons
                          value={row.correct_answer}
                          onChange={(n) => updateCorrectAnswer(i, n)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
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
