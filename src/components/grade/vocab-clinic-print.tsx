'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PrintFitText } from '@/components/grade/print-fit-text'

type ClinicVocabItem = {
  id: string
  test_number: number
  prompt_text: string | null
  prompt_source: string | null
  vocab_word: {
    english_word: string
    correct_answer: string | null
  } | null
}

type ClinicVocabTest = {
  title: string
  createdAt?: string
  items: ClinicVocabItem[]
}

const ITEMS_PER_PAGE = 50
const ITEMS_PER_COLUMN = 25

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

function loadDraft(draftKey: string | null) {
  if (!draftKey) return null
  const raw = localStorage.getItem(draftKey)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ClinicVocabTest
    if (!Array.isArray(parsed.items)) return null
    return parsed
  } catch {
    return null
  }
}

export function VocabClinicPrint({ mode }: { mode: 'student' | 'grading' }) {
  const [test, setTest] = useState<ClinicVocabTest | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const key = new URLSearchParams(window.location.search).get('draft')
      setTest(loadDraft(key))
      setLoaded(true)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    document.body.classList.add('bg-white')
    return () => document.body.classList.remove('bg-white')
  }, [])

  const items = useMemo(
    () => (test?.items ?? []).slice().sort((a, b) => a.test_number - b.test_number),
    [test?.items]
  )
  const pages = chunk(items, ITEMS_PER_PAGE)
  const isGrading = mode === 'grading'

  function switchMode(nextMode: 'student' | 'grading') {
    const nextPath = nextMode === 'grading' ? 'clinic-grading-print' : 'clinic-print'
    const url = window.location.pathname.replace(/clinic(?:-grading)?-print$/, nextPath) + window.location.search
    window.location.href = url
  }

  if (!loaded) return <div className="p-8 text-sm text-gray-500">시험지를 불러오는 중...</div>
  if (!test || items.length === 0) {
    return <div className="p-8 text-sm text-red-500">시험지 데이터를 찾을 수 없습니다. 설정 탭에서 다시 인쇄해 주세요.</div>
  }

  return (
    <div className="min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex w-[210mm] items-center justify-between print:hidden">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{test.title}</h1>
          <p className="text-xs text-gray-500">
            {items.length}문항 · {isGrading ? '채점용 인쇄' : 'A4 인쇄 전용'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => switchMode(isGrading ? 'student' : 'grading')}
          >
            {isGrading ? '시험지 보기' : '정답지 보기'}
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
                  <p className="text-[10px] font-bold tracking-[0.24em] text-gray-500">
                    {isGrading ? 'Vocabulary Grading Sheet' : 'Vocabulary Test'}
                  </p>
                  <h2 className="mt-1 text-2xl font-black text-gray-950">
                    {isGrading ? '어휘 채점표' : '어휘 Test'}
                  </h2>
                </div>
                {isGrading ? (
                  <p className="text-sm font-bold text-gray-700">{items.length}문항</p>
                ) : (
                  <div className="grid grid-cols-[44px_150px] gap-y-3 text-sm">
                    <span className="font-bold text-gray-700">이름</span>
                    <span className="border-b border-gray-700" />
                    <span className="font-bold text-gray-700">점수</span>
                    <span className="border-b border-gray-700" />
                  </div>
                )}
              </header>

              <div className={`grid grid-cols-2 ${isGrading ? 'gap-x-8' : 'gap-x-10'}`}>
                {[left, right].map((column, columnIndex) => (
                  <div key={columnIndex} className="space-y-0">
                    {column.map((item) => {
                      const word = item.prompt_text || item.vocab_word?.english_word || ''
                      const answer = item.vocab_word?.correct_answer || '-'
                      return isGrading ? (
                        <div
                          key={item.id}
                          className="grid h-[34px] grid-cols-[34px_minmax(0,1fr)_minmax(0,1.05fr)] items-center gap-2 border-b border-gray-200"
                        >
                          <span className="text-right text-[13px] font-bold text-gray-900">{item.test_number}.</span>
                          <PrintFitText text={word} maxSize={14} minSize={9} className="font-semibold text-gray-900" />
                          <PrintFitText text={answer} maxSize={14} minSize={9} className="font-bold text-gray-950" />
                        </div>
                      ) : (
                        <div key={item.id} className="grid h-[34px] grid-cols-[36px_minmax(0,1fr)_132px] items-end gap-2">
                          <span className="pb-1 text-right text-[13px] font-bold text-gray-900">{item.test_number}.</span>
                          <PrintFitText text={word} maxSize={15} minSize={9} className="pb-1 font-semibold text-gray-900" />
                          <span className="h-[22px] border-b border-gray-500" />
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
