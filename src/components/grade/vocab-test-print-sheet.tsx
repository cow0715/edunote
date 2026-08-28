'use client'

import { PrintFitText } from '@/components/grade/print-fit-text'
import { splitBlankedSentence, splitChoiceSentence } from '@/lib/vocab-example-blank'

export const EXAMPLE_SOURCES = ['example_meaning', 'example', 'example_choice'] as const
export function isExampleSource(source: string | null | undefined) {
  return (EXAMPLE_SOURCES as readonly string[]).includes(source ?? '')
}

// 시험지/프리뷰 공용 인쇄 레이아웃.
// A파트(뜻쓰기)는 2단, 예문 파트(뜻쓰기 영→한 / 빈칸 영→영)는 1단 블록으로 이어 붙인다.
// 예문 파트가 있으면 A파트를 좌우 균등 분할 + 행 높이 압축해 최대한 한 페이지에 담는다.

export type VocabPrintItem = {
  id: string
  test_number: number
  prompt_source: string | null
  prompt_text: string | null
  /** 뜻쓰기 파트에 인쇄할 단어 (variant 우선 적용 후 값) */
  display_word: string
}

/**
 * 테스트용 "답 채우기": 문항 번호 → 학생 답. 답란 위에 손글씨풍으로 얹어 그린다.
 * 프린터 없이 채점 파이프라인(OCR→파싱→채점)을 돌려보기 위한 것. 선택형은 고른 단어를 넣으면 그 후보에 동그라미.
 */
export type VocabPrintAnswers = Record<number, string>

const ITEMS_PER_PAGE = 50
const ITEMS_PER_COLUMN = 25

// 손글씨 느낌 — 시스템에 있는 필기체 계열 우선, 없으면 italic 폴백
const HANDWRITING_STYLE: React.CSSProperties = {
  fontFamily: '"Segoe Print", "Bradley Hand", "Comic Sans MS", "Nanum Pen Script", "Gaegu", cursive',
  color: '#1d4ed8',
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

/** 답란 밑줄. answer 가 있으면 밑줄 위에 손글씨풍으로 얹는다 */
function ExampleBlank({ width, answer }: { width: number; answer?: string }) {
  return (
    <span className="relative inline-block h-[1em] translate-y-[3px] border-b-[1.5px] border-gray-800 align-baseline" style={{ width }}>
      {answer && (
        <span className="absolute inset-x-0 -top-[14px] whitespace-nowrap text-center text-[15px] leading-none" style={HANDWRITING_STYLE}>
          {answer}
        </span>
      )}
    </span>
  )
}

/** 예문 빈칸(영→영): 문장 속 마커 자리에 빈칸 밑줄 */
function BlankSentence({ text, answer }: { text: string; answer?: string }) {
  const parts = splitBlankedSentence(text)
  return (
    <p className="text-[13.5px] font-medium leading-[30px] text-gray-900">
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 && <ExampleBlank width={92} answer={answer} />}
        </span>
      ))}
    </p>
  )
}

/** 예문 뜻쓰기(영→한): 문장 그대로 + 행 끝 뜻 쓰기 밑줄 */
function MeaningSentence({ text, answer }: { text: string; answer?: string }) {
  return (
    <p className="text-[13.5px] font-medium leading-[30px] text-gray-900">
      {text} <ExampleBlank width={120} answer={answer} />
    </p>
  )
}

/** 예문 선택형: 정답지와 같은 [ A / B ] 텍스트 형식. 두 후보 사이를 넉넉히 띄워 동그라미 칠 공간 확보 */
function ChoiceSentence({ text, answer }: { text: string; answer?: string }) {
  const parsed = splitChoiceSentence(text)
  if (!parsed) return <p className="text-[13.5px] font-medium leading-[30px] text-gray-900">{text}</p>
  const picked = (answer ?? '').trim().toLowerCase()
  const option = (word: string) => {
    const isPicked = picked && word.toLowerCase() === picked
    return (
      <span className="relative mx-2.5 inline-block font-bold">
        {word}
        {/* 손으로 친 동그라미 느낌: 살짝 기울고 삐뚤한 타원 */}
        {isPicked && (
          <span
            className="pointer-events-none absolute -inset-x-2 -inset-y-[3px] rounded-[50%] border-2"
            style={{ borderColor: '#1d4ed8', transform: 'rotate(-3deg)', borderTopLeftRadius: '55% 45%', borderBottomRightRadius: '45% 55%' }}
          />
        )}
      </span>
    )
  }
  return (
    <p className="text-[13.5px] font-medium leading-[30px] text-gray-900">
      {parsed.before}
      <span className="font-semibold">[</span>
      {option(parsed.options[0])}
      <span className="text-gray-500">/</span>
      {option(parsed.options[1])}
      <span className="font-semibold">]</span>
      {parsed.after}
    </p>
  )
}

type ExampleSection = {
  key: string
  title: string
  instruction: string
  items: VocabPrintItem[]
  kind: 'meaning' | 'blank' | 'choice'
}

export function VocabTestPrintSheet({ items, answers, studentName }: { items: VocabPrintItem[]; answers?: VocabPrintAnswers; studentName?: string }) {
  const sorted = items.slice().sort((a, b) => a.test_number - b.test_number)
  const answerOf = (n: number) => answers?.[n]?.trim() || undefined
  const meaningItems = sorted.filter((item) => !isExampleSource(item.prompt_source))
  const exampleSections: ExampleSection[] = [
    {
      key: 'example_meaning',
      title: '예문 뜻쓰기',
      instruction: '괄호 안 단어의 뜻을 쓰시오.',
      items: sorted.filter((item) => item.prompt_source === 'example_meaning'),
      kind: 'meaning' as const,
    },
    {
      key: 'example',
      title: '예문 빈칸',
      instruction: '빈칸에 알맞은 영어 단어를 쓰시오.',
      items: sorted.filter((item) => item.prompt_source === 'example'),
      kind: 'blank' as const,
    },
    {
      key: 'example_choice',
      title: '예문 선택',
      instruction: '[ ] 안에서 문맥에 알맞은 단어에 동그라미 하시오.',
      items: sorted.filter((item) => item.prompt_source === 'example_choice'),
      kind: 'choice' as const,
    },
  ].filter((section) => section.items.length > 0)

  const partCount = (meaningItems.length > 0 ? 1 : 0) + exampleSections.length
  const showPartLabels = partCount > 1
  const partLetter = (index: number) => String.fromCharCode(65 + index)
  const compact = exampleSections.length > 0
  const meaningPages = chunk(meaningItems, ITEMS_PER_PAGE)
  const pageCount = Math.max(meaningPages.length, exampleSections.length > 0 ? 1 : 0)

  return (
    <div className="mx-auto space-y-4 print:space-y-0">
      {Array.from({ length: pageCount }, (_, pageIndex) => {
        const pageItems = meaningPages[pageIndex] ?? []
        // 예문 파트가 있으면 좌우 균등 분할로 A파트 세로 길이를 최소화한다 (한 페이지 목표)
        const perColumn = compact ? Math.ceil(pageItems.length / 2) : ITEMS_PER_COLUMN
        const left = pageItems.slice(0, perColumn)
        const right = pageItems.slice(perColumn)
        const isLastPage = pageIndex === pageCount - 1
        return (
          <section key={pageIndex} className="vocab-print-page bg-white shadow-sm print:shadow-none">
            <header className="mb-5 flex items-end justify-between border-b-2 border-gray-900 pb-3">
              <div>
                <p className="text-[10px] font-bold tracking-[0.28em] text-gray-500">Vocabulary Test</p>
                <h2 className="mt-1 text-2xl font-black text-gray-950">어휘 Test</h2>
              </div>
              {/* 이름·점수 한 줄 — 두 줄이면 사진이 단어 표만 담을 때 이름란이 프레임 밖으로 나가
                  일괄 채점 이름 매칭이 실패한다. 헤더를 낮춰 표와 같이 찍히게 한다. */}
              <div className="flex items-end gap-2 text-sm">
                <span className="font-bold text-gray-700">이름</span>
                <span className="relative w-[130px] border-b border-gray-700">
                  {studentName && <span className="absolute inset-x-0 -top-[2px] text-center text-[16px]" style={HANDWRITING_STYLE}>{studentName}</span>}
                  &nbsp;
                </span>
                <span className="ml-3 font-bold text-gray-700">점수</span>
                <span className="w-[72px] border-b border-gray-700">&nbsp;</span>
              </div>
            </header>

            {pageItems.length > 0 && (
              <>
                {showPartLabels && pageIndex === 0 && (
                  <p className="mb-2 text-[12px] font-black text-gray-900">
                    {partLetter(0)}. 뜻쓰기 <span className="ml-1 font-semibold text-gray-500">— 다음 단어의 뜻을 쓰시오. ({meaningItems.length}문항)</span>
                  </p>
                )}
                <div className="grid grid-cols-2 gap-x-10">
                  {[left, right].map((column, columnIndex) => (
                    <div key={columnIndex} className="space-y-0">
                      {column.map((item) => (
                        <div
                          key={item.id}
                          className={`grid ${compact ? 'h-[30px]' : 'h-[34px]'} grid-cols-[36px_minmax(0,1fr)_132px] items-end gap-2`}
                        >
                          <span className="pb-1 text-right text-[13px] font-bold text-gray-900">{item.test_number}.</span>
                          <PrintFitText text={item.display_word} maxSize={compact ? 14 : 15} minSize={9} className="pb-1 font-semibold text-gray-900" />
                          <span className={`relative ${compact ? 'h-[20px]' : 'h-[22px]'} border-b border-gray-500`}>
                            {answerOf(item.test_number) && (
                              <span className="absolute inset-x-1 bottom-[1px] whitespace-nowrap text-[15px] leading-none" style={HANDWRITING_STYLE}>
                                {answerOf(item.test_number)}
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}

            {isLastPage && exampleSections.map((section, sectionIndex) => {
              const partIndex = (meaningItems.length > 0 ? 1 : 0) + sectionIndex
              return (
                <div key={section.key} className={partIndex > 0 || pageItems.length > 0 ? 'mt-6' : ''}>
                  {showPartLabels && (
                    <p className="mb-1.5 border-t border-gray-300 pt-4 text-[12px] font-black text-gray-900">
                      {partLetter(partIndex)}. {section.title}{' '}
                      <span className="ml-1 font-semibold text-gray-500">— {section.instruction} ({section.items.length}문항)</span>
                    </p>
                  )}
                  <div className="space-y-0">
                    {section.items.map((item) => (
                      <div key={item.id} className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-2 py-[3px]" style={{ breakInside: 'avoid' }}>
                        <span className="text-right text-[13px] font-bold leading-[30px] text-gray-900">{item.test_number}.</span>
                        {section.kind === 'blank'
                          ? <BlankSentence text={item.prompt_text ?? ''} answer={answerOf(item.test_number)} />
                          : section.kind === 'choice'
                            ? <ChoiceSentence text={item.prompt_text ?? ''} answer={answerOf(item.test_number)} />
                            : <MeaningSentence text={item.prompt_text ?? ''} answer={answerOf(item.test_number)} />}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
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
