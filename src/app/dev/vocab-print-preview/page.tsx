'use client'

// 단어시험 유형 확장으로 바뀐 화면들을 샘플 데이터로 한 번에 보는 개발용 갤러리.
// 시험지·정답지·비율 패널은 실제 컴포넌트를 그대로 렌더하고,
// 채점 정오표·학부모 오답 카드·재시험 카드는 해당 화면의 마크업을 샘플로 재현한다.

import { useEffect, useState } from 'react'
import { CheckCircle2, ChevronDown, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VocabTestPrintSheet } from '@/components/grade/vocab-test-print-sheet'
import { VocabGradingPrintSheet } from '@/components/grade/vocab-grading-print-sheet'
import { VocabSourceRatioPanel } from '@/components/grade/vocab-source-ratio-panel'
import { ExampleSentenceInline, EXAMPLE_LABEL, ANSWER_RIGHT_CLASS, ANSWER_WRONG_CLASS, isExampleSourceValue } from '@/components/grade/vocab-example-inline'
import { parseChoiceOptions } from '@/lib/vocab-example-blank'
import { buildSampleItems, SAMPLE_STUDENT_ANSWERS, LEGACY_STUDENT_ANSWERS, type SampleItem } from './sample-data'
import { DEFAULT_SOURCE_RATIO, VocabSourceRatio, allocatePromptTargets, rebalanceSourceRatio } from '@/lib/vocab-test-ratio'

const PRESETS = [
  { label: '24 + 뜻 4 + 빈칸 3 + 선택 3', meaning: 24, exampleMeaning: 4, exampleBlank: 3, exampleChoice: 3 },
  { label: '26 + 뜻 5 + 빈칸 5', meaning: 26, exampleMeaning: 5, exampleBlank: 5, exampleChoice: 0 },
  { label: '30 + 예문뜻 8', meaning: 30, exampleMeaning: 8, exampleBlank: 0, exampleChoice: 0 },
  { label: '30 + 선택 8', meaning: 30, exampleMeaning: 0, exampleBlank: 0, exampleChoice: 8 },
  { label: '40 (기존 레이아웃)', meaning: 40, exampleMeaning: 0, exampleBlank: 0, exampleChoice: 0 },
] as const

type Tab = 'test' | 'filled' | 'grading' | 'sheet' | 'share' | 'retake' | 'retakeResult'
const TABS: Array<{ key: Tab; label: string; desc: string }> = [
  { key: 'test', label: '시험지', desc: 'A(뜻쓰기 2단) + B/C/D 예문 파트. 예문 있으면 1페이지 압축' },
  { key: 'filled', label: '채워진 시험지', desc: '채점 테스트용 — 학생이 답을 쓴 상태 (손글씨풍). 이걸 캡처해 OCR 채점에 넣는다' },
  { key: 'grading', label: '정답지', desc: '뜻쓰기 표 + 예문 파트 정답 강조 (빈칸 밑줄 / 선택 동그라미)' },
  { key: 'sheet', label: '채점 정오표', desc: '강사 채점 화면 — 시험지 순서대로 뜻쓰기 2단 → 예문 파트' },
  { key: 'share', label: '학부모 오답 카드', desc: 'share 화면 — 문제 그대로 → 내 답 · 정답' },
  { key: 'retake', label: '재시험 카드', desc: '유형 그대로 — 예문뜻/빈칸 입력, 선택은 버튼 2개' },
  { key: 'retakeResult', label: '재시험 결과', desc: '제출 후 카드가 하나씩 뒤집히며 정오 표시. 오답은 펼쳐서 유의어·반의어' },
]

/** 샘플 오답 생성: 유형별로 그럴듯한 틀린 답 */
function sampleWrongAnswer(item: SampleItem) {
  if (item.prompt_source === 'example') return item.answer.slice(0, -2) + 'de'
  if (item.prompt_source === 'example_choice') {
    const m = /\[\s*([^\]/]+?)\s*\/\s*([^\]/]+?)\s*\]/.exec(item.prompt_text ?? '')
    if (!m) return 'exclude'
    return m[1].trim().toLowerCase() === item.answer.toLowerCase() ? m[2].trim() : m[1].trim()
  }
  return '모르겠음'
}

// ── 채점 정오표 재현 (vocab-sheet-content.tsx 와 같은 구조: 뜻쓰기 2단 → 예문 파트 1단) ──
function GradingSheetPreview({ items }: { items: SampleItem[] }) {
  const meaningRows = items.filter((i) => !isExampleSourceValue(i.prompt_source)).slice(0, 8)
  const exampleParts = (['example_meaning', 'example', 'example_choice'] as const)
    .map((source) => ({ source, rows: items.filter((i) => i.prompt_source === source) }))
    .filter((part) => part.rows.length > 0)
  const isCorrectAt = (i: number, isExample: boolean) => (isExample ? i % 2 === 0 : i % 5 !== 2)
  const answerOf = (a: SampleItem, correct: boolean) => correct
    ? (a.prompt_source === 'example' || a.prompt_source === 'example_choice' ? a.answer : a.meaning)
    : sampleWrongAnswer(a)
  const total = meaningRows.length + exampleParts.reduce((s, p) => s + p.rows.length, 0)

  const controls = (studentAnswer: string, isCorrect: boolean, widthClass: string) => (
    <>
      <span className={`min-w-0 border-b border-gray-200 px-0.5 ${isCorrect ? 'text-emerald-700' : 'text-rose-500'} ${widthClass}`}>{studentAnswer}</span>
      <span className={`w-5 shrink-0 text-center font-bold ${isCorrect ? 'text-green-500' : 'text-red-400'}`}>{isCorrect ? '✓' : '✗'}</span>
    </>
  )

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-2 text-xs text-gray-400">
        <span className="font-medium text-green-600">{total - 6}정</span> / <span className="font-medium text-red-400">6오</span> / {total}개
      </p>
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-[11px] font-bold text-gray-500">뜻쓰기 <span className="font-normal text-gray-400">{meaningRows.length}문항</span></p>
          <div className="columns-1 gap-x-4 sm:columns-2">
            {meaningRows.map((a, i) => {
              const ok = isCorrectAt(i, false)
              return (
                <div key={a.id} className="flex min-w-0 items-center gap-1 break-inside-avoid rounded px-0.5 py-0.5 text-xs">
                  <span className="w-5 shrink-0 text-right text-gray-300">{a.test_number}.</span>
                  <span className="w-24 shrink-0 truncate font-mono text-gray-600">{a.display_word}</span>
                  <span className="shrink-0 text-gray-300">→</span>
                  {controls(answerOf(a, ok), ok, 'flex-1')}
                </div>
              )
            })}
          </div>
        </div>
        {exampleParts.map((part) => (
          <div key={part.source} className="border-t border-gray-100 pt-2">
            <p className="mb-1 text-[11px] font-bold text-gray-500">
              {EXAMPLE_LABEL[part.source].long} <span className="font-normal text-gray-400">{part.rows.length}문항 · {EXAMPLE_LABEL[part.source].hint}</span>
            </p>
            <div className="space-y-0.5">
              {part.rows.map((a, i) => {
                const ok = isCorrectAt(i, true)
                return (
                  <div key={a.id} className="flex min-w-0 items-center gap-1 rounded px-0.5 py-0.5 text-xs">
                    <span className="w-5 shrink-0 text-right text-gray-300">{a.test_number}.</span>
                    <div className="min-w-0 flex-1">
                      <ExampleSentenceInline
                        source={part.source}
                        promptText={a.prompt_text ?? ''}
                        answer={part.source === 'example_meaning' ? a.meaning : a.answer}
                        isCorrect={ok}
                        size="xs"
                      />
                    </div>
                    <span className="shrink-0 text-gray-300">→</span>
                    {controls(answerOf(a, ok), ok, 'w-28 shrink-0')}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 학부모 오답 카드 재현 (share-client.tsx 와 같은 마크업 + 실제 ExampleSentenceInline) ──
function ShareCardPreview({ items }: { items: SampleItem[] }) {
  // 유형별로 하나씩 골라 카드 4개
  const pick = (source: string) => items.find((i) => i.prompt_source === source)
  const wrong = [items[1], pick('example_meaning'), pick('example'), pick('example_choice')].filter((i): i is SampleItem => !!i)
  return (
    <div className="max-w-md overflow-hidden rounded-2xl border border-gray-100 bg-white">
      <div className="divide-y divide-gray-100">
        {wrong.map((va) => {
          const exampleSource = isExampleSourceValue(va.prompt_source) ? va.prompt_source : null
          const isEnglishAnswer = va.prompt_source === 'example' || va.prompt_source === 'example_choice'
          const myAnswer = sampleWrongAnswer(va)
          const correctText = isEnglishAnswer ? va.answer : va.meaning
          const studentInSentence = isEnglishAnswer
          return (
            <div key={va.id} className="px-5 py-3">
              {/* 1. 문제 (시험지 그대로) */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {exampleSource && va.prompt_text ? (
                    <>
                      <ExampleSentenceInline
                        source={exampleSource}
                        promptText={va.prompt_text}
                        answer={correctText}
                        studentAnswer={myAnswer}
                        isCorrect={false}
                        fill="student"
                      />
                      {va.translation && <p className="mt-0.5 text-[11px] leading-4 text-gray-400">{va.translation}</p>}
                    </>
                  ) : (
                    <span className="text-sm font-bold text-gray-900">{va.display_word}</span>
                  )}
                </div>
                <span className="shrink-0 text-xs text-gray-400">#{va.test_number}</span>
              </div>
              {/* 2. 내 답 · 정답 */}
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                {!studentInSentence && (
                  <span><span className="mr-1 text-[11px] text-gray-400">내 답</span><span className={ANSWER_WRONG_CLASS}>{myAnswer}</span></span>
                )}
                {exampleSource === 'example_choice' && va.prompt_text ? (
                  (() => {
                    const options = parseChoiceOptions(va.prompt_text)
                    if (!options) return null
                    return options.map((option, index) => {
                      const isAnswer = option.toLowerCase() === correctText.toLowerCase()
                      const isPicked = !isAnswer && option.toLowerCase() === myAnswer.toLowerCase()
                      return (
                        <span key={index}>
                          <span className={isAnswer ? ANSWER_RIGHT_CLASS : isPicked ? ANSWER_WRONG_CLASS : 'font-semibold text-gray-700'}>{option}</span>
                          <span className="ml-1 text-gray-500">{va.choiceMeanings?.[index] ?? ''}</span>
                        </span>
                      )
                    })
                  })()
                ) : (
                  <>
                    <span><span className="mr-1 text-[11px] text-gray-400">정답</span><span className={ANSWER_RIGHT_CLASS}>{correctText}</span></span>
                    {exampleSource && (
                      <span className="text-gray-500"><span className="mr-1 text-[11px] text-gray-400">{va.display_word}</span>{va.meaning}</span>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 재시험 카드 재현 (retake/page.tsx 와 같은 마크업) ────────────────────
function RetakeCardPreview({ items }: { items: SampleItem[] }) {
  const [typed, setTyped] = useState<Record<string, string>>({})
  const pick = (source: string) => items.find((i) => i.prompt_source === source)
  const cards = [items[0], pick('example_meaning'), pick('example'), pick('example_choice')].filter((i): i is SampleItem => !!i)
  const kindLabel = (s: string | null) => s === 'example' ? '빈칸 채우기' : s === 'example_choice' ? '알맞은 단어 고르기' : s === 'example_meaning' ? '괄호 단어의 뜻' : null
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {cards.map((w) => {
        const kind = w.prompt_source
        const label = kindLabel(kind)
        const t = typed[w.id]?.trim()
        const blankParts = kind === 'example' && w.prompt_text ? (() => { const m = /_{3,}/.exec(w.prompt_text); return m ? [w.prompt_text.slice(0, m.index), w.prompt_text.slice(m.index + m[0].length)] : null })() : null
        const choiceOptions = kind === 'example_choice' && w.prompt_text ? (() => { const m = /\[\s*([^\]/]+?)\s*\/\s*([^\]/]+?)\s*\]/.exec(w.prompt_text); return m ? [m[1].trim(), m[2].trim()] : null })() : null
        return (
          <div key={w.id} className="rounded-3xl bg-gradient-to-b from-[#EBF3FF] to-white p-4">
            <div className="rounded-3xl bg-white px-8 py-8 text-center shadow-[0_10px_40px_rgba(0,75,198,0.03)]">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-gray-300">
                No. {w.test_number}{label && <span className="ml-2 normal-case tracking-normal text-indigo-400">· {label}</span>}
              </p>
              {kind === 'example' && blankParts ? (
                <p className="text-lg font-semibold leading-relaxed text-gray-900">
                  {blankParts[0]}
                  <span className={`inline-block min-w-[72px] border-b-2 px-1 text-center ${t ? 'border-indigo-400 text-indigo-600' : 'border-gray-300'}`}>{t || ' '}</span>
                  {blankParts[1]}
                </p>
              ) : kind === 'example_choice' && w.prompt_text ? (
                <p className="text-lg font-semibold leading-relaxed text-gray-900">{w.prompt_text.replace(/\[\s*[^\]]+\]/, '[ ? ]')}</p>
              ) : kind === 'example_meaning' ? (
                <>
                  <p className="mb-3 text-base font-medium leading-relaxed text-gray-700">{w.prompt_text}</p>
                  <p className="text-2xl font-black text-gray-900">{w.display_word}</p>
                </>
              ) : (
                <p className="text-3xl font-black text-gray-900">{w.display_word}</p>
              )}
            </div>
            <div className="mt-4">
              {choiceOptions ? (
                <div className="grid grid-cols-2 gap-3">
                  {choiceOptions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setTyped((p) => ({ ...p, [w.id]: option }))}
                      className={`rounded-2xl border-2 px-4 py-3 text-lg font-bold transition-all ${typed[w.id] === option ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-gray-200 bg-white text-gray-800'}`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  type="text"
                  placeholder={kind === 'example' ? '영어 단어를 입력하세요' : '한글 뜻을 입력하세요'}
                  value={typed[w.id] ?? ''}
                  onChange={(e) => setTyped((p) => ({ ...p, [w.id]: e.target.value }))}
                  className="w-full rounded-2xl border-2 border-gray-200 bg-white px-5 py-3 text-center text-lg font-semibold text-gray-900 outline-none placeholder:text-gray-300 focus:border-indigo-400"
                />
              )}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-2xl bg-white/70 px-3 py-2 text-xs text-gray-500">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> 정답: <b className="text-gray-800">{kind === 'example' || kind === 'example_choice' ? w.answer : w.meaning}</b>
              <XCircle className="ml-auto h-4 w-4 text-rose-300" />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── 재시험 결과 재현 (retake/page.tsx revealing/done 화면과 같은 마크업) ─────────
function RetakeResultPreview({ items }: { items: SampleItem[] }) {
  const pick = (source: string) => items.find((i) => i.prompt_source === source)
  const cards = [items[0], items[2], pick('example_meaning'), pick('example'), pick('example_choice')].filter((i): i is SampleItem => !!i)
  // 1·3번째 정답, 나머지 오답
  const rows = cards.map((w, i) => ({ w, ok: i === 0 || i === 3 }))
  const correct = rows.filter((r) => r.ok).length
  const pct = Math.round((correct / rows.length) * 100)
  return (
    <div className="mx-auto max-w-lg space-y-3.5 rounded-3xl bg-gradient-to-b from-[#EBF3FF] to-white p-4">
      <div className={`rounded-3xl bg-gradient-to-br ${pct >= 60 ? 'from-amber-400 to-orange-500' : 'from-rose-500 to-pink-500'} p-6 text-center text-white`}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest opacity-70">이번 라운드</p>
        <p className="mb-2 text-6xl font-black leading-none">{pct}%</p>
        <p className="text-sm opacity-90">{rows.length}개 중 <strong>{correct}개</strong> 정답</p>
        <p className="mt-1.5 text-xs opacity-75">아직 {rows.length - correct}개 남았어요</p>
      </div>
      <div className="space-y-2">
        {rows.map(({ w, ok }) => {
          const source = isExampleSourceValue(w.prompt_source) ? w.prompt_source : null
          const isEnglish = source === 'example' || source === 'example_choice'
          const myAnswer = ok ? (isEnglish ? w.answer : w.meaning) : sampleWrongAnswer(w)
          return (
            <div key={w.id} className={`overflow-hidden rounded-2xl bg-white ring-1 ${ok ? 'ring-gray-100' : 'ring-rose-100'}`}>
              <div className="flex items-center gap-3 px-4 py-3.5">
                <div className="shrink-0">{ok ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <XCircle className="h-5 w-5 text-rose-400" />}</div>
                <div className="min-w-0 flex-1">
                  {source && isEnglish && w.prompt_text ? (
                    <>
                      <ExampleSentenceInline source={source} promptText={w.prompt_text} answer={w.answer} studentAnswer={myAnswer} isCorrect={ok} fill="student" />
                      {w.translation && <p className="mt-0.5 text-[11px] leading-4 text-gray-400">{w.translation}</p>}
                      {!ok && (
                        <p className="mt-1 text-sm">
                          {source === 'example_choice' && w.prompt_text ? (
                            (parseChoiceOptions(w.prompt_text) ?? []).map((option, index) => {
                              const isAnswer = option.toLowerCase() === w.answer.toLowerCase()
                              const isPicked = !isAnswer && option.toLowerCase() === myAnswer.toLowerCase()
                              return <span key={index} className={index === 1 ? 'ml-3' : ''}><span className={isAnswer ? ANSWER_RIGHT_CLASS : isPicked ? ANSWER_WRONG_CLASS : 'font-semibold text-gray-700'}>{option}</span></span>
                            })
                          ) : (
                            <><span className="mr-1 text-[11px] text-gray-400">정답</span><span className={ANSWER_RIGHT_CLASS}>{w.answer}</span></>
                          )}
                          <span className="ml-3 text-gray-500"><span className="mr-1 text-[11px] text-gray-400">{w.display_word}</span>{w.meaning}</span>
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      {source && w.prompt_text ? (
                        <>
                          <ExampleSentenceInline source={source} promptText={w.prompt_text} />
                          {w.translation && <p className="mt-0.5 text-[11px] leading-4 text-gray-400">{w.translation}</p>}
                        </>
                      ) : (
                        <p className="text-sm font-semibold leading-tight text-gray-900">{w.display_word}</p>
                      )}
                      <p className="mt-1 text-sm">
                        <span className="mr-1 text-[11px] text-gray-400">내 답</span>
                        <span className={ok ? ANSWER_RIGHT_CLASS : ANSWER_WRONG_CLASS}>{myAnswer}</span>
                        {!ok && <><span className="ml-3 mr-1 text-[11px] text-gray-400">정답</span><span className={ANSWER_RIGHT_CLASS}>{w.meaning}</span></>}
                        {source && <span className="ml-3 text-[11px] text-gray-400">{w.display_word}</span>}
                      </p>
                    </>
                  )}
                </div>
                {!ok && <ChevronDown className="h-4 w-4 shrink-0 text-gray-300" />}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * URL 파라미터: ?tab=filled 로 초기 탭, ?bare=1 이면 컨트롤 없이 시트만 (headless 캡처용),
 * ?preset=legacy 면 기존 형식(뜻쓰기 40) — 그 외 preset 값은 PRESETS 인덱스(0~4)
 */
function readInitialParams(): { tab: Tab; bare: boolean; presetIndex: number } {
  const sp = new URLSearchParams(window.location.search)
  const t = sp.get('tab') as Tab | null
  const valid = TABS.some((x) => x.key === t)
  const presetParam = sp.get('preset')
  const presetIndex = presetParam === 'legacy' ? PRESETS.length - 1
    : presetParam && /^\d+$/.test(presetParam) ? Math.min(PRESETS.length - 1, Number(presetParam))
    : 0
  return { tab: valid && t ? t : 'test', bare: sp.get('bare') === '1', presetIndex }
}

export default function VocabPrintPreviewPage() {
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>(PRESETS[0])
  const [ratio, setRatio] = useState<VocabSourceRatio>(DEFAULT_SOURCE_RATIO)
  const [{ tab, bare }, setTabState] = useState<{ tab: Tab; bare: boolean }>({ tab: 'test', bare: false })
  const setTab = (t: Tab) => setTabState((s) => ({ ...s, tab: t }))
  const items = buildSampleItems(preset.meaning, preset.exampleMeaning, preset.exampleBlank, preset.exampleChoice)

  // URL 파라미터는 마운트 후 반영 (SSR 과 첫 렌더를 맞추기 위해). dev 전용 페이지라 깜빡임은 무시.
  useEffect(() => {
    const p = readInitialParams()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTabState({ tab: p.tab, bare: p.bare })
    setPreset(PRESETS[p.presetIndex])
  }, [])

  useEffect(() => {
    document.body.classList.add('bg-white')
    return () => document.body.classList.remove('bg-white')
  }, [])

  const isPrint = tab === 'test' || tab === 'filled' || tab === 'grading'

  return (
    <div className={bare ? 'bg-white' : 'min-h-screen bg-gray-100 py-6 print:bg-white print:py-0'}>
      <div className={`mx-auto mb-4 w-[210mm] space-y-3 print:hidden ${bare ? 'hidden' : ''}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-gray-900">단어시험 유형 확장 — 바뀐 화면 모아보기</h1>
            <p className="text-xs text-gray-500">
              샘플 데이터 · 뜻쓰기 {preset.meaning} + 예문뜻 {preset.exampleMeaning} + 빈칸 {preset.exampleBlank} + 선택 {preset.exampleChoice}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {PRESETS.map((p) => (
              <Button key={p.label} size="sm" variant={preset.label === p.label ? 'default' : 'outline'} onClick={() => setPreset(p)}>
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${tab === t.key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {t.label}
            </button>
          ))}
          <span className="ml-auto self-center pr-2 text-[11px] text-gray-400">{TABS.find((t) => t.key === tab)?.desc}</span>
        </div>

        {tab === 'test' && (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <p className="border-b border-gray-100 px-4 pt-3 pb-2 text-xs font-bold text-gray-700">출제 비율 패널 (출제 UI에 들어가는 실제 컴포넌트)</p>
            <VocabSourceRatioPanel
              ratio={ratio}
              targets={allocatePromptTargets(40, ratio)}
              onChangeRatio={(source, value) => setRatio((prev) => rebalanceSourceRatio(prev, source, value))}
              onSelectPreset={setRatio}
            />
          </div>
        )}
      </div>

      {isPrint ? (
        tab === 'test' ? <VocabTestPrintSheet items={items} />
          : tab === 'filled' ? <div id="filled-sheet"><VocabTestPrintSheet items={items} answers={preset.exampleMeaning + preset.exampleBlank + preset.exampleChoice === 0 ? LEGACY_STUDENT_ANSWERS : SAMPLE_STUDENT_ANSWERS} studentName="김테스트" /></div>
          : <VocabGradingPrintSheet items={items} />
      ) : (
        <div className="mx-auto w-[210mm] print:hidden">
          {tab === 'sheet' && <GradingSheetPreview items={items} />}
          {tab === 'share' && <ShareCardPreview items={items} />}
          {tab === 'retake' && <RetakeCardPreview items={items} />}
          {tab === 'retakeResult' && <RetakeResultPreview items={items} />}
        </div>
      )}
    </div>
  )
}
