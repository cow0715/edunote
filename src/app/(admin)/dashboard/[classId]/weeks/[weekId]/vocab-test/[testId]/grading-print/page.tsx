'use client'

import { use, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'

type VocabTestItem = {
  id: string
  test_number: number
  prompt_text: string | null
  prompt_source: string | null
  vocab_word: {
    english_word: string
    correct_answer: string | null
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

const ITEMS_PER_PAGE = 50
const ITEMS_PER_COLUMN = 25

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
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
  const items = (test?.items ?? []).slice().sort((a, b) => a.test_number - b.test_number)
  const pages = chunk(items, ITEMS_PER_PAGE)

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

      <div className="mx-auto space-y-4 print:space-y-0">
        {pages.map((pageItems, pageIndex) => {
          const left = pageItems.slice(0, ITEMS_PER_COLUMN)
          const right = pageItems.slice(ITEMS_PER_COLUMN)
          return (
            <section key={pageIndex} className="vocab-print-page bg-white shadow-sm print:shadow-none">
              <header className="mb-5 flex items-end justify-between border-b-2 border-gray-900 pb-3">
                <div>
                  <p className="text-[10px] font-bold tracking-[0.24em] text-gray-500">Vocabulary Grading Sheet</p>
                  <h2 className="mt-1 text-2xl font-black text-gray-950">어휘 채점용</h2>
                </div>
                <p className="text-sm font-bold text-gray-700">{items.length}문항</p>
              </header>

              <div className="grid grid-cols-2 gap-x-8">
                {[left, right].map((column, columnIndex) => (
                  <div key={columnIndex} className="space-y-0">
                    {column.map((item) => {
                      const word = item.prompt_text || item.vocab_word?.english_word || ''
                      const answer = item.vocab_word?.correct_answer || '-'
                      return (
                        <div
                          key={item.id}
                          className="grid h-[34px] grid-cols-[34px_minmax(0,1fr)_minmax(0,1.05fr)] items-center gap-2 border-b border-gray-200"
                        >
                          <span className="text-right text-[13px] font-bold text-gray-900">{item.test_number}.</span>
                          <span className="truncate text-[14px] font-semibold text-gray-900" title={word}>
                            {word}
                          </span>
                          <span className="truncate text-[14px] font-bold text-gray-950" title={answer}>
                            {answer}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>

      <style jsx global>{`
        @page {
          size: A4 portrait;
          margin: 10mm;
        }

        .vocab-print-page {
          width: 210mm;
          min-height: 297mm;
          padding: 12mm 12mm 11mm;
          box-sizing: border-box;
          page-break-after: always;
        }

        .vocab-print-page:last-child {
          page-break-after: auto;
        }

        @media print {
          html,
          body {
            width: 210mm;
            background: white !important;
          }

          .vocab-print-page {
            width: auto;
            min-height: auto;
            padding: 0;
            margin: 0;
          }
        }
      `}</style>
    </div>
  )
}
