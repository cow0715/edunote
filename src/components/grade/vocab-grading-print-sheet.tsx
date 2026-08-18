'use client'

import { PrintFitText } from '@/components/grade/print-fit-text'
import { isExampleSource } from '@/components/grade/vocab-test-print-sheet'
import { splitBlankedSentence, splitChoiceSentence } from '@/lib/vocab-example-blank'

// 정답지(채점용) 공용 인쇄 레이아웃. 정규/클리닉 정답지가 함께 쓴다.
// 뜻쓰기 파트는 2단 표, 예문 파트는 문장 + 정답 강조로 표시한다.

export type VocabGradingItem = {
  id: string
  test_number: number
  prompt_source: string | null
  prompt_text: string | null
  /** 뜻쓰기 파트에 표시할 단어 */
  display_word: string
  /** 채점 정답 (뜻쓰기·예문뜻쓰기: 한글 뜻, 예문빈칸: 영어 표면형) */
  answer: string
}

const ITEMS_PER_PAGE = 50
const ITEMS_PER_COLUMN = 25

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

/** 예문 빈칸(영→영): 빈칸 자리에 정답을 강조해 표시 */
function BlankAnswerSentence({ text, answer }: { text: string; answer: string }) {
  const parts = splitBlankedSentence(text)
  return (
    <p className="text-[12.5px] leading-6 text-gray-700">
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 && (
            <b className="font-black text-gray-950 underline decoration-2 underline-offset-2">{answer}</b>
          )}
        </span>
      ))}
    </p>
  )
}

/** 예문 뜻쓰기(영→한): 문장 + 정답 뜻 표시 */
function MeaningAnswerSentence({ text, answer }: { text: string; answer: string }) {
  return (
    <p className="text-[12.5px] leading-6 text-gray-700">
      {text} <b className="ml-1 font-black text-gray-950">→ {answer}</b>
    </p>
  )
}

/** 예문 선택형: 정답 쪽을 강조 표시 (answer 는 정답 표면형) */
function ChoiceAnswerSentence({ text, answer }: { text: string; answer: string }) {
  const parsed = splitChoiceSentence(text)
  if (!parsed) return <p className="text-[12.5px] leading-6 text-gray-700">{text}</p>
  return (
    <p className="text-[12.5px] leading-6 text-gray-700">
      {parsed.before}
      [{' '}
      {parsed.options.map((option, index) => (
        <span key={index}>
          {index === 1 && <span className="text-gray-400"> / </span>}
          {option.toLowerCase() === answer.toLowerCase()
            ? <b className="rounded-full border-2 border-gray-950 px-1.5 font-black text-gray-950">{option}</b>
            : <span className="text-gray-400">{option}</span>}
        </span>
      ))}
      {' '}]
      {parsed.after}
    </p>
  )
}

export function VocabGradingPrintSheet({ items }: { items: VocabGradingItem[] }) {
  const sorted = items.slice().sort((a, b) => a.test_number - b.test_number)
  const meaningItems = sorted.filter((item) => !isExampleSource(item.prompt_source))
  const exampleItems = sorted.filter((item) => isExampleSource(item.prompt_source))
  const hasBothParts = meaningItems.length > 0 && exampleItems.length > 0
  const pages = chunk(meaningItems, ITEMS_PER_PAGE)
  const pageCount = Math.max(pages.length, exampleItems.length > 0 ? 1 : 0)

  return (
    <div className="mx-auto space-y-4 print:space-y-0">
      {Array.from({ length: pageCount }, (_, pageIndex) => {
        const pageItems = pages[pageIndex] ?? []
        const left = pageItems.slice(0, ITEMS_PER_COLUMN)
        const right = pageItems.slice(ITEMS_PER_COLUMN)
        const isLastPage = pageIndex === pageCount - 1
        const showExamples = isLastPage && exampleItems.length > 0
        return (
          <section key={pageIndex} className="vocab-print-page bg-white shadow-sm print:shadow-none">
            <header className="mb-5 flex items-end justify-between border-b-2 border-gray-900 pb-3">
              <div>
                <p className="text-[10px] font-bold tracking-[0.24em] text-gray-500">Vocabulary Grading Sheet</p>
                <h2 className="mt-1 text-2xl font-black text-gray-950">어휘 채점용</h2>
              </div>
              <p className="text-sm font-bold text-gray-700">{sorted.length}문항</p>
            </header>

            {pageItems.length > 0 && (
              <>
                {hasBothParts && pageIndex === 0 && (
                  <p className="mb-2 text-[12px] font-black text-gray-900">뜻쓰기 ({meaningItems.length}문항)</p>
                )}
                <div className="grid grid-cols-2 gap-x-8">
                  {[left, right].map((column, columnIndex) => (
                    <div key={columnIndex} className="space-y-0">
                      {column.map((item) => (
                        <div
                          key={item.id}
                          className="grid h-[34px] grid-cols-[34px_minmax(0,1fr)_minmax(0,1.05fr)] items-center gap-2 border-b border-gray-200"
                        >
                          <span className="text-right text-[13px] font-bold text-gray-900">{item.test_number}.</span>
                          <PrintFitText text={item.display_word} maxSize={14} minSize={9} className="font-semibold text-gray-900" />
                          <PrintFitText text={item.answer || '-'} maxSize={14} minSize={9} className="font-bold text-gray-950" />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}

            {showExamples && (
              <div className={pageItems.length > 0 ? 'mt-6' : ''}>
                {hasBothParts && (
                  <p className="mb-1.5 border-t border-gray-300 pt-4 text-[12px] font-black text-gray-900">예문 ({exampleItems.length}문항)</p>
                )}
                <div className="space-y-0">
                  {exampleItems.map((item) => (
                    <div key={item.id} className="grid grid-cols-[34px_minmax(0,1fr)] items-start gap-2 border-b border-gray-200 py-1.5" style={{ breakInside: 'avoid' }}>
                      <span className="text-right text-[13px] font-bold leading-6 text-gray-900">{item.test_number}.</span>
                      {item.prompt_source === 'example'
                        ? <BlankAnswerSentence text={item.prompt_text ?? ''} answer={item.answer || '-'} />
                        : item.prompt_source === 'example_choice'
                          ? <ChoiceAnswerSentence text={item.prompt_text ?? ''} answer={item.answer || '-'} />
                          : <MeaningAnswerSentence text={item.prompt_text ?? ''} answer={item.answer || '-'} />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )
      })}

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
