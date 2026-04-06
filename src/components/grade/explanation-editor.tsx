'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { ExamQuestion } from '@/lib/types'

interface Props {
  weekId: string
}

const STYLE_LABEL: Record<string, string> = {
  objective: '객관식',
  ox: 'O/X 교정형',
  multi_select: '복수정답',
  subjective: '서술형',
  find_error: '오류교정',
}

const ANSWER_TEXT_LABEL: Record<string, string> = {
  ox: '정답 (예: O 또는 X(correction))',
  subjective: '모범답안',
  multi_select: '복수정답 (예: 1,3)',
  find_error: '정정어',
}

interface EditRow {
  explanation: string
  correct_answer_text: string
  grading_criteria: string
}

export function ExplanationEditor({ weekId }: Props) {
  const qc = useQueryClient()

  const { data: questions = [], isLoading } = useQuery<ExamQuestion[]>({
    queryKey: ['exam-questions', weekId],
    queryFn: async () => {
      const res = await fetch(`/api/weeks/${weekId}/questions`)
      if (!res.ok) throw new Error('조회 실패')
      return res.json()
    },
  })

  const readingQuestions = questions.filter((q) => q.exam_type === 'reading')

  const [editMap, setEditMap] = useState<Record<string, EditRow>>({})

  const snapshot = readingQuestions
    .map((q) => `${q.id}:${q.explanation}:${q.correct_answer_text}:${q.grading_criteria}`)
    .join('|')

  useEffect(() => {
    if (!readingQuestions.length) return
    const map: Record<string, EditRow> = {}
    for (const q of readingQuestions) {
      map[q.id] = {
        explanation: q.explanation ?? '',
        correct_answer_text: q.correct_answer_text ?? '',
        grading_criteria: q.grading_criteria ?? '',
      }
    }
    setEditMap(map)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot])

  function setField(id: string, field: keyof EditRow, value: string) {
    setEditMap((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  const save = useMutation({
    mutationFn: async () => {
      const updates = readingQuestions.map((q) => {
        const row = editMap[q.id]
        const update: Record<string, unknown> = {
          id: q.id,
          concept_tag_ids: (q.exam_question_tag ?? [])
            .map((t) => t.concept_tag?.id)
            .filter((id): id is string => !!id),
          explanation: row?.explanation ?? null,
        }
        if (q.question_style !== 'objective') {
          update.correct_answer_text_override = row?.correct_answer_text || null
        }
        if (q.question_style === 'subjective') {
          update.grading_criteria = row?.grading_criteria || null
        }
        return update
      })
      const res = await fetch(`/api/weeks/${weekId}/questions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error('저장 실패')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exam-questions', weekId] })
      toast.success('해설 저장 완료')
    },
    onError: () => toast.error('저장 실패'),
  })

  if (isLoading) return <div className="h-20 animate-pulse rounded-lg bg-gray-100" />

  if (readingQuestions.length === 0) return null

  return (
    <div className="space-y-3 pt-5 border-t">
      <div>
        <p className="text-sm font-medium text-gray-800">AI 추출 결과 확인</p>
        <p className="text-xs text-gray-400 mt-0.5">
          정답·해설을 직접 수정할 수 있습니다. 객관식 정답 번호는 문항 유형 탭에서 수정하세요.
        </p>
      </div>

      <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
        {readingQuestions.map((q) => {
          const row = editMap[q.id] ?? { explanation: '', correct_answer_text: '', grading_criteria: '' }
          const label = `${q.question_number}번${q.sub_label ? ` (${q.sub_label})` : ''}`
          const styleLabel = STYLE_LABEL[q.question_style] ?? q.question_style
          const answerLabel = ANSWER_TEXT_LABEL[q.question_style]

          return (
            <div key={q.id} className="rounded-lg border bg-white p-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-800">{label}</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
                  {styleLabel}
                </span>
              </div>

              {/* 모범답안 (비객관식) */}
              {q.question_style !== 'objective' && answerLabel && (
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-gray-500">{answerLabel}</label>
                  <Textarea
                    rows={2}
                    className="resize-none text-xs"
                    placeholder="AI가 추출한 정답이 없습니다"
                    value={row.correct_answer_text}
                    onChange={(e) => setField(q.id, 'correct_answer_text', e.target.value)}
                  />
                </div>
              )}

              {/* 채점기준 (서술형) */}
              {q.question_style === 'subjective' && (
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-gray-500">채점 기준</label>
                  <Textarea
                    rows={2}
                    className="resize-none text-xs"
                    placeholder="채점 기준이 없습니다"
                    value={row.grading_criteria}
                    onChange={(e) => setField(q.id, 'grading_criteria', e.target.value)}
                  />
                </div>
              )}

              {/* 해설 (전 유형) */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-gray-500">해설 / 오답 포인트</label>
                <Textarea
                  rows={2}
                  className="resize-none text-xs"
                  placeholder="해설이 없습니다"
                  value={row.explanation}
                  onChange={(e) => setField(q.id, 'explanation', e.target.value)}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? '저장 중...' : '저장'}
        </Button>
      </div>
    </div>
  )
}
