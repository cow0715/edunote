'use client'

import { use, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { VocabTestPrintSheet, VocabPrintItem } from '@/components/grade/vocab-test-print-sheet'

type VocabTestItem = {
  id: string
  test_number: number
  prompt_text: string | null
  prompt_source: string | null
  vocab_word: {
    english_word: string
  } | null
  vocab_word_variant?: {
    word: string
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

export default function VocabTestPrintPage({
  params,
}: {
  params: Promise<{ classId: string; weekId: string; testId: string }>
}) {
  const { classId, weekId, testId } = use(params)
  const { data, isLoading, error } = useQuery<VocabTestResponse>({
    queryKey: ['vocab-test-print', weekId, testId],
    queryFn: async () => {
      const res = await fetch(`/api/weeks/${weekId}/vocab-tests?testId=${testId}`)
      if (!res.ok) throw new Error((await res.json()).error ?? '시험지를 불러올 수 없습니다')
      return res.json()
    },
  })

  const test = data?.tests[0] ?? null
  const items: VocabPrintItem[] = (test?.items ?? []).map((item) => ({
    id: item.id,
    test_number: item.test_number,
    prompt_source: item.prompt_source,
    prompt_text: item.prompt_text,
    display_word: item.vocab_word_variant?.word || item.prompt_text || item.vocab_word?.english_word || '',
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
          <p className="text-xs text-gray-500">{items.length}문항 · A4 인쇄 전용</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => window.location.href = `/dashboard/${classId}/weeks/${weekId}/vocab-test/${testId}/grading-print`}
          >
            정답지 보기
          </Button>
          <Button onClick={() => window.print()}>인쇄</Button>
        </div>
      </div>

      <VocabTestPrintSheet items={items} />
    </div>
  )
}
