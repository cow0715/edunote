'use client'

import { use, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { VocabGradingPrintSheet, VocabGradingItem } from '@/components/grade/vocab-grading-print-sheet'
import { extractBlankAnswer, extractChoiceAnswerIndex, parseChoiceOptions } from '@/lib/vocab-example-blank'

type VocabTestItem = {
  id: string
  test_number: number
  prompt_text: string | null
  prompt_source: string | null
  vocab_word: {
    english_word: string
    correct_answer: string | null
    example_sentence?: string | null
  } | null
  vocab_word_variant?: {
    word: string
    meaning: string | null
  } | null
}

type VocabTest = {
  id: string
  title: string
  item_count: number
  items: VocabTestItem[]
}

type VocabTestResponse = {
  tests: VocabTest[]
  activeTest: VocabTest | null
}

function itemAnswer(item: VocabTestItem): string {
  if (item.prompt_source === 'example') {
    return extractBlankAnswer(item.vocab_word?.example_sentence, item.prompt_text)
      ?? item.vocab_word?.english_word
      ?? '-'
  }
  if (item.prompt_source === 'example_meaning') {
    return item.vocab_word?.correct_answer || '-'
  }
  if (item.prompt_source === 'example_choice') {
    const index = extractChoiceAnswerIndex(item.vocab_word?.example_sentence, item.prompt_text)
    const options = parseChoiceOptions(item.prompt_text)
    return (index !== null && options ? options[index] : null) ?? item.vocab_word?.english_word ?? '-'
  }
  if (item.vocab_word_variant) return item.vocab_word_variant.meaning || '-'
  return item.vocab_word?.correct_answer || '-'
}

export default function VocabGradingPrintPage({
  params,
}: {
  params: Promise<{ classId: string; weekId: string; testId: string }>
}) {
  const { classId, weekId, testId } = use(params)
  const { data, isLoading, error } = useQuery<VocabTestResponse>({
    queryKey: ['vocab-test-grading-print', weekId, testId],
    queryFn: async () => {
      const res = await fetch(`/api/weeks/${weekId}/vocab-tests?testId=${testId}`)
      if (!res.ok) throw new Error((await res.json()).error ?? '시험지를 불러올 수 없습니다')
      return res.json()
    },
  })

  const test = data?.tests[0] ?? null
  const items: VocabGradingItem[] = (test?.items ?? []).map((item) => ({
    id: item.id,
    test_number: item.test_number,
    prompt_source: item.prompt_source,
    prompt_text: item.prompt_text,
    display_word: item.vocab_word_variant?.word || item.prompt_text || item.vocab_word?.english_word || '',
    answer: itemAnswer(item),
  }))

  useEffect(() => {
    document.body.classList.add('bg-white')
    return () => document.body.classList.remove('bg-white')
  }, [])

  if (isLoading) return <div className="p-8 text-sm text-gray-500">시험지를 불러오는 중...</div>
  if (error || !test) return <div className="p-8 text-sm text-red-500">시험지를 찾을 수 없습니다.</div>

  return (
    <div className="min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex w-[210mm] items-center justify-between print:hidden">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{test.title}</h1>
          <p className="text-xs text-gray-500">{items.length}문항 · 채점용 인쇄</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => window.location.href = `/dashboard/${classId}/weeks/${weekId}/vocab-test/${testId}/print`}
          >
            시험지 보기
          </Button>
          <Button onClick={() => window.print()}>인쇄</Button>
        </div>
      </div>

      <VocabGradingPrintSheet items={items} />
    </div>
  )
}
