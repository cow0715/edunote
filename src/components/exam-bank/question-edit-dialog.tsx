'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { QUESTION_TYPE_LABELS } from './constants'
import { MarkdownField } from './markdown'
import type { ExamBankQuestion } from './types'

// ── 문항 추가/수정 다이얼로그 ─────────────────────────────────────────────

const EMPTY_FORM = {
  question_number: '',
  question_type: '',
  question_text: '',
  passage: '',
  choices: ['', '', '', '', ''],
  answer: '',
}

export function QuestionEditDialog({
  examId,
  target,
  onClose,
}: {
  examId: string
  target: ExamBankQuestion | null | 'new'
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const isNew = target === 'new'
  const open = target !== null

  const [form, setForm] = useState(EMPTY_FORM)

  // 이미 렌더 중 조정 패턴이지만, 직전 값을 ref 로 들고 있으면 렌더 중 ref 접근이 된다.
  // 같은 역할을 state 로 하면 React 가 지원하는 형태가 된다.
  const [syncedTarget, setSyncedTarget] = useState<typeof target>(null)
  if (target !== syncedTarget) {
    setSyncedTarget(target)
    if (target && target !== 'new') {
      const q = target
      setForm({
        question_number: String(q.question_number),
        question_type: q.question_type,
        question_text: q.question_text,
        passage: q.passage || '',
        choices: q.choices.length === 5 ? q.choices : [...q.choices, ...Array(5 - q.choices.length).fill('')],
        answer: q.answer || '',
      })
    } else if (target === 'new') {
      setForm(EMPTY_FORM)
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        question_number: Number(form.question_number),
        question_type: form.question_type,
        question_text: form.question_text.trim(),
        passage: form.passage.trim(),
        choices: form.choices.map((c) => c.trim()).filter(Boolean),
        answer: form.answer.trim(),
      }
      const url = isNew
        ? `/api/exam-bank/${examId}/questions`
        : `/api/exam-bank/${examId}/questions/${(target as ExamBankQuestion).id}`
      const method = isNew ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '저장 실패')
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam-bank-questions', examId] })
      queryClient.invalidateQueries({ queryKey: ['exam-bank'] })
      toast.success(isNew ? '문항이 추가되었습니다' : '문항이 수정되었습니다')
      onClose()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '저장 실패'),
  })

  const setChoice = (i: number, val: string) => {
    const next = [...form.choices]
    next[i] = val
    setForm({ ...form, choices: next })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? '문항 추가' : `${(target as ExamBankQuestion)?.question_number}번 문항 수정`}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>문항 번호</Label>
              <Input
                type="number"
                min={18}
                max={45}
                value={form.question_number}
                onChange={(e) => setForm({ ...form, question_number: e.target.value })}
                placeholder="예: 38"
              />
            </div>
            <div>
              <Label>문항 유형</Label>
              <Select value={form.question_type} onValueChange={(v) => setForm({ ...form, question_type: v })}>
                <SelectTrigger><SelectValue placeholder="유형 선택" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <MarkdownField
            label="발문 (+ 주어진 문장)"
            minRows={3}
            value={form.question_text}
            onChange={(v) => setForm({ ...form, question_text: v })}
            placeholder="다음 글의 목적으로 가장 적절한 것은?"
          />

          <MarkdownField
            label="지문"
            minRows={8}
            value={form.passage}
            onChange={(v) => setForm({ ...form, passage: v })}
            placeholder="지문 내용 (없으면 비워두세요)"
          />

          <div>
            <Label>보기 (5개)</Label>
            <div className="space-y-2">
              {['①', '②', '③', '④', '⑤'].map((sym, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-5 text-sm text-gray-500 shrink-0">{sym}</span>
                  <Input
                    value={form.choices[i] ?? ''}
                    onChange={(e) => setChoice(i, e.target.value)}
                    placeholder={`${sym} 보기 내용`}
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label>정답</Label>
            <Input
              value={form.answer}
              onChange={(e) => setForm({ ...form, answer: e.target.value })}
              placeholder="예: 3 또는 2,4"
              className="max-w-32"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>취소</Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.question_number || !form.question_type || !form.question_text}
            >
              {saveMutation.isPending ? '저장 중...' : '저장'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
