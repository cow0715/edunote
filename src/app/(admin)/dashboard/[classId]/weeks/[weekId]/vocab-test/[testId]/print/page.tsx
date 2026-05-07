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

export default function VocabTestPrintPage({
  params,
}: {
  params: Promise<{ classId: string; weekId: string; testId: string }>
}) {
  const { weekId, testId } = use(params)
  const { data, isLoading, error } = useQuery<VocabTestResponse>({
    queryKey: ['vocab-test-print', weekId, testId],
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
          <p className="text-xs text-gray-500">{items.length}문항 · A4 인쇄 전용</p>
        </div>
        <Button onClick={() => window.print()}>인쇄</Button>
      </div>

      <div className="mx-auto space-y-4 print:space-y-0">
        {pages.map((pageItems, pageIndex) => {
          const left = pageItems.slice(0, ITEMS_PER_COLUMN)
          const right = pageItems.slice(ITEMS_PER_COLUMN)
          return (
            <section key={pageIndex} className="vocab-print-page bg-white shadow-sm print:shadow-none">
              <header className="mb-5 flex items-end justify-between border-b-2 border-gray-900 pb-3">
                <div>
                  <p className="text-[10px] font-bold tracking-[0.28em] text-gray-500">Vocabulary Test</p>
                  <h2 className="mt-1 text-2xl font-black text-gray-950">어휘 Test</h2>
                </div>
                <div className="grid grid-cols-[44px_150px] gap-y-2 text-sm">
                  <span className="font-bold text-gray-700">이름</span>
                  <span className="border-b border-gray-700" />
                  <span className="font-bold text-gray-700">점수</span>
                  <span className="border-b border-gray-700" />
                </div>
              </header>

              <div className="grid grid-cols-2 gap-x-10">
                {[left, right].map((column, columnIndex) => (
                  <div key={columnIndex} className="space-y-0">
                    {column.map((item) => {
                      const word = item.prompt_text || item.vocab_word?.english_word || ''
                      return (
                        <div key={item.id} className="grid h-[27px] grid-cols-[31px_minmax(0,1fr)_124px] items-end gap-2">
                          <span className="pb-0.5 text-right text-[11px] font-bold text-gray-900">{item.test_number}.</span>
                          <span className="truncate pb-0.5 text-[12px] font-semibold text-gray-900" title={word}>
                            {word}
                          </span>
                          <span className="h-[17px] border-b border-gray-500" />
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
          margin: 9mm;
        }

        .vocab-print-page {
          width: 210mm;
          min-height: 297mm;
          padding: 11mm 12mm 10mm;
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
