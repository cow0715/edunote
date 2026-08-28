'use client'

// 단어시험 유형 확장으로 바뀐 화면들을 샘플 데이터로 한 번에 보는 개발용 갤러리.
// 시험지·정답지·비율 패널은 실제 컴포넌트를 그대로 렌더하고,
// 채점 정오표·학부모 오답 카드·재시험 카드는 해당 화면의 마크업을 샘플로 재현한다.

import { useEffect, useState } from 'react'
import { CheckCircle2, ChevronDown, Images, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VocabBatchGradeDialog } from '@/components/grade/vocab-batch-grade-dialog'
import { ExamSheetContent } from '@/components/grade/exam-sheet-content'
import { SubjectiveReviewPanel } from '@/components/grade/subjective-review-panel'
import type { ExamQuestion } from '@/lib/types'
import type { GradeRow } from '@/hooks/use-grade'
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

type Tab = 'test' | 'filled' | 'grading' | 'sheet' | 'share' | 'retake' | 'retakeResult' | 'batch' | 'exam' | 'review'
const TABS: Array<{ key: Tab; label: string; desc: string }> = [
  { key: 'test', label: '시험지', desc: 'A(뜻쓰기 2단) + B/C/D 예문 파트. 예문 있으면 1페이지 압축' },
  { key: 'filled', label: '채워진 시험지', desc: '채점 테스트용 — 학생이 답을 쓴 상태 (손글씨풍). 이걸 캡처해 OCR 채점에 넣는다' },
  { key: 'grading', label: '정답지', desc: '뜻쓰기 표 + 예문 파트 정답 강조 (빈칸 밑줄 / 선택 동그라미)' },
  { key: 'sheet', label: '채점 정오표', desc: '강사 채점 화면 — 시험지 순서대로 뜻쓰기 2단 → 예문 파트' },
  { key: 'share', label: '학부모 오답 카드', desc: 'share 화면 — 문제 그대로 → 내 답 · 정답' },
  { key: 'retake', label: '재시험 카드', desc: '유형 그대로 — 예문뜻/빈칸 입력, 선택은 버튼 2개' },
  { key: 'retakeResult', label: '재시험 결과', desc: '제출 후 카드가 하나씩 뒤집히며 정오 표시. 오답은 펼쳐서 유의어·반의어' },
  { key: 'batch', label: '일괄 채점', desc: '사진 여러 장 → 이름 자동 매칭 확인 → 병렬 채점. 실제 다이얼로그, API 는 가짜 응답' },
  { key: 'exam', label: '진단평가 채점지', desc: '강사 채점 화면(시험 셀) — 인쇄 답안지와 같은 표(번호 | 답), 같은 순서. 정답 테두리·오답 빨강. 실제 컴포넌트' },
  { key: 'review', label: '서술형 검토', desc: '검토 패널 — 세그먼트 토글(옅은 채움=AI 판정, 진한 채움=교사 확정), 정렬 고정. 실제 컴포넌트' },
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
                // 선택형은 학생이 고른 쪽에 동그라미 — 실제 정오표와 같은 표시
                const isChoice = part.source === 'example_choice'
                const student = answerOf(a, ok)
                return (
                  <div key={a.id} className="flex min-w-0 items-center gap-1 rounded px-0.5 py-0.5 text-xs">
                    <span className="w-5 shrink-0 text-right text-gray-300">{a.test_number}.</span>
                    <div className="min-w-0 flex-1">
                      <ExampleSentenceInline
                        source={part.source}
                        promptText={a.prompt_text ?? ''}
                        answer={part.source === 'example_meaning' ? a.meaning : a.answer}
                        studentAnswer={student}
                        isCorrect={ok}
                        size="xs"
                        onPickOption={isChoice ? () => {} : undefined}
                      />
                    </div>
                    {isChoice ? (
                      <span className={`w-5 shrink-0 text-center font-bold ${ok ? 'text-green-500' : 'text-red-400'}`}>{ok ? '✓' : '✗'}</span>
                    ) : (
                      <>
                        <span className="shrink-0 text-gray-300">→</span>
                        {controls(student, ok, 'w-28 shrink-0')}
                      </>
                    )}
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

// ── 일괄 채점 다이얼로그 (실제 컴포넌트, fetch 만 가짜) ──────────────────────
const BATCH_SAMPLE_STUDENTS = [
  { student_id: 's1', student_name: '김민준', present: true, hasExisting: false },
  { student_id: 's2', student_name: '이서연', present: true, hasExisting: true },
  { student_id: 's3', student_name: '박지호', present: true, hasExisting: false },
  { student_id: 's4', student_name: '김테스트', present: true, hasExisting: false },
  { student_id: 's5', student_name: '최수아', present: false, hasExisting: false },
  { student_id: 's6', student_name: '정하은', present: true, hasExisting: false },
]

/**
 * 갤러리 전용: /api/weeks/*\/vocab-photo-name 과 grade-vocab-photo 를 가로채 그럴듯한 응답을 준다.
 * 파일명에 학생 이름이 있으면 그 학생(high), "low"가 있으면 low, "none"이면 미매칭. 채점은 1.5~3초 후 랜덤 점수, "fail" 이면 실패.
 */
function installBatchMockFetch() {
  const real = window.fetch.bind(window)
  // 갤러리에서는 덮어쓰기 confirm 을 자동 수락 (headless/자동화 캡처에서 모달이 렌더러를 막지 않도록)
  const realConfirm = window.confirm
  window.confirm = () => true
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  /** 샘플 파일 내용("sample:파일명")을 base64 에서 되살린다. 진짜 이미지면 빈 문자열 */
  const hintOf = (b64: string | undefined) => {
    try {
      const text = decodeURIComponent(escape(atob((b64 ?? '').slice(0, 200))))
      return text.startsWith('sample:') ? text : ''
    } catch { return '' }
  }
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/vocab-photo-name')) {
      await sleep(600 + Math.random() * 900)
      const body = JSON.parse(String(init?.body ?? '{}')) as { fileData?: string }
      const hint = hintOf(body.fileData)
      const found = BATCH_SAMPLE_STUDENTS.find((s) => hint.includes(s.student_name))
      if (hint.includes('none') || !found) return new Response(JSON.stringify({ studentId: null, name: null, rawName: hint.includes('none') ? '징혜스트' : null, confidence: 'none' }))
      const low = hint.includes('low')
      return new Response(JSON.stringify({ studentId: found.student_id, name: found.student_name, rawName: low ? found.student_name.slice(0, -1) + '민' : found.student_name, confidence: low ? 'low' : 'high' }))
    }
    if (url.includes('/grade-vocab-photo')) {
      await sleep(1500 + Math.random() * 1500)
      const body = JSON.parse(String(init?.body ?? '{}')) as { fileData?: string }
      if (hintOf(body.fileData).includes('fail')) return new Response(JSON.stringify({ ok: false, error: '단어를 찾을 수 없습니다' }), { status: 422 })
      const correct = 20 + Math.floor(Math.random() * 14)
      return new Response(JSON.stringify({ ok: true, vocab_correct: correct, vocab_total: 34, results: [] }))
    }
    return real(input, init)
  }) as typeof window.fetch
  return () => { window.fetch = real; window.confirm = realConfirm }
}

/** 갤러리용 가짜 파일 — 파일명을 base64 대신 힌트로 쓸 수 있게 내용에 파일명을 박는다 */
function makeSampleFile(name: string) {
  return new File([`sample:${name}`], name, { type: 'image/png' })
}

function BatchGradePreview() {
  const [open, setOpen] = useState(false)
  useEffect(() => installBatchMockFetch(), [])
  // ?auto=review 면 샘플 5장으로 자동 열기(매칭 화면), ?auto=done 이면 채점까지 자동 진행 (headless 캡처용)
  useEffect(() => {
    const auto = new URLSearchParams(window.location.search).get('auto')
    if (!auto) return
    const t = setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[data-batch-sample]')?.click()
      if (auto === 'done') {
        setTimeout(() => {
          const start = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => /채점 시작/.test(b.textContent ?? ''))
          start?.click()
        }, 3500)
      }
    }, 600)
    return () => clearTimeout(t)
  }, [])
  // 갤러리에서는 실제 사진 대신 이 파일들을 드롭한 셈 친다 — 열면 안내 + 버튼
  const sampleFiles = [
    makeSampleFile('IMG_0412_김민준.jpg'),
    makeSampleFile('IMG_0413_이서연.jpg'),
    makeSampleFile('IMG_0414_박지호_low.jpg'),
    makeSampleFile('IMG_0415_none.jpg'),
    makeSampleFile('IMG_0416_정하은_fail.jpg'),
  ]
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600">
        <p className="mb-2 font-bold text-gray-800">채점 그리드 상단에 이 버튼이 생깁니다 →</p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
        >
          <Images className="h-3.5 w-3.5" />
          단어 시험지 일괄 채점
        </button>
        <p className="mt-3 text-[11px] leading-5 text-gray-500">
          갤러리에서는 API 가 가짜 응답입니다. 다이얼로그에서 아무 이미지나 드롭하면 파일명으로 흉내냅니다 —
          파일명에 <b>김민준/이서연/박지호/정하은/김테스트</b> 가 있으면 그 학생에 매칭(high), <b>low</b> 가 있으면 노란 점,
          <b>none</b> 이면 미매칭, <b>fail</b> 이면 채점 실패. 이서연은 기채점 학생(덮어쓰기 confirm), 최수아는 결석.
          <br />
          바로 보려면 아래 「샘플 5장으로 열기」.
        </p>
        <button
          type="button"
          data-batch-sample
          onClick={() => {
            setOpen(true)
            // 다이얼로그가 마운트된 뒤 숨은 file input 을 찾아 샘플 파일을 주입
            setTimeout(() => {
              const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="file"]')
              if (!input) return
              const dt = new DataTransfer()
              sampleFiles.forEach((f) => dt.items.add(f))
              input.files = dt.files
              input.dispatchEvent(new Event('change', { bubbles: true }))
            }, 250)
          }}
          className="mt-2 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
        >
          샘플 5장으로 열기
        </button>
      </div>
      <VocabBatchGradeDialog
        open={open}
        onOpenChange={setOpen}
        weekId="sample-week"
        students={BATCH_SAMPLE_STUDENTS}
        onGraded={() => {}}
      />
    </div>
  )
}

// ── 진단평가 정오표 (실제 ExamSheetContent, 답안은 로컬 state) ──────────────────
function sampleExamQuestion(partial: Partial<ExamQuestion> & { id: string; question_number: number }): ExamQuestion {
  return {
    week_id: 'sample-week', sub_label: null, question_type: null, question_text: null, question_stem: null, passage: null,
    choices: null, correct_answer: 0, correct_answer_text: null, extra_correct_answers: [], grading_criteria: null,
    explanation: null, needs_source_image: false, source_image_reason: null, source_page: null, source_bbox: null,
    source_image_path: null, exam_type: 'reading', question_style: 'objective', is_void: false, all_correct: false,
    created_at: '', ...partial,
  }
}

const EXAM_SAMPLE_QUESTIONS: ExamQuestion[] = [
  ...Array.from({ length: 18 }, (_, i) => sampleExamQuestion({ id: `q${i + 1}`, question_number: i + 1, correct_answer: (i * 7) % 5 + 1 })),
  sampleExamQuestion({ id: 'q19a', question_number: 19, sub_label: 'a', correct_answer: 2 }),
  sampleExamQuestion({ id: 'q19b', question_number: 19, sub_label: 'b', correct_answer: 4 }),
  sampleExamQuestion({ id: 'q19c', question_number: 19, sub_label: 'c', correct_answer: 1 }),
  sampleExamQuestion({ id: 'q20', question_number: 20, correct_answer: 3, extra_correct_answers: [5] }),
  sampleExamQuestion({ id: 'q21', question_number: 21, correct_answer: 2, all_correct: true }),
  sampleExamQuestion({ id: 'q22', question_number: 22, correct_answer: 4, is_void: true }),
  sampleExamQuestion({ id: 'q23', question_number: 23, correct_answer: 1, needs_source_image: true, source_image_reason: '도표' }),
  sampleExamQuestion({ id: 'q24', question_number: 24, correct_answer: 5 }),
  sampleExamQuestion({ id: 'q25', question_number: 25, question_style: 'ox', correct_answer_text: 'X → have' }),
  // T/F 판단형 — 버튼·정답키가 O/X 가 아니라 시험지대로 T/F 로 나와야 한다
  sampleExamQuestion({ id: 'q27a', question_number: 27, sub_label: 'a', question_style: 'ox', correct_answer_text: 'T' }),
  sampleExamQuestion({ id: 'q27b', question_number: 27, sub_label: 'b', question_style: 'ox', correct_answer_text: 'F' }),
  sampleExamQuestion({ id: 'q26', question_number: 26, question_style: 'subjective', correct_answer_text: 'The author claims that ...' }),
  // find_error — 채점 입력이 "기호:고친 표현" 정규형을 안내해야 한다
  sampleExamQuestion({ id: 'q28', question_number: 28, question_style: 'find_error', correct_answer_text: '4:satisfied' }),
]

function SubjectiveReviewPreview() {
  const questions: ExamQuestion[] = [
    sampleExamQuestion({
      id: 'rq4', question_number: 4, question_style: 'subjective',
      correct_answer_text: '가상 음악 공장에서 일하는 것처럼 노래를 조립하는 방법을 고안했다.',
      grading_criteria: '핵심 개념(가상 공장/조립 방식)이 담기면 정답',
    }),
    sampleExamQuestion({
      id: 'rq7', question_number: 7, sub_label: 'a', question_style: 'find_error',
      correct_answer_text: '4:satisfied',
    }),
  ]
  const mkRow = (id: string, name: string, byQ: Record<string, { text: string; is_correct?: boolean; needs_review?: boolean; feedback?: string }>): GradeRow => ({
    student_id: id, student_name: name, present: true, vocab_correct: null,
    reading_present: true, reading_correct: null, homework_done: null, memo: '',
    answers: questions.map((q) => {
      const a = byQ[q.id]
      return {
        exam_question_id: q.id,
        student_answer: null,
        student_answer_text: a?.text ?? '',
        is_correct: a?.is_correct,
        needs_review: a?.needs_review ?? false,
        teacher_confirmed: false,
        ai_feedback: a?.feedback ?? '',
      }
    }),
  })
  const rows: GradeRow[] = [
    mkRow('r1', '김검토', {
      rq4: { text: '가상 음악 공쟝에서 노래를 조립함', is_correct: false, needs_review: true, feedback: 'AI 응답 누락 — 수동 확인 필요' },
      rq7: { text: '4: satisfied', is_correct: false, needs_review: true, feedback: 'AI 채점 실패 — 수동 확인 필요' },
    }),
    mkRow('r2', '박오답', {
      rq4: { text: '노래방에서 연습했다', is_correct: false, feedback: '핵심 개념 없음' },
      rq7: { text: '③ whose → who', is_correct: false, feedback: '④번이 정답 (③번 선택)' },
    }),
    mkRow('r3', '이정답', {
      rq4: { text: '가상 음악 공장에서 일하듯 노래를 조립하는 방법을 고안', is_correct: true },
      rq7: { text: '4:satisfied', is_correct: true },
    }),
    mkRow('r4', '최미입력', { rq4: { text: '' }, rq7: { text: '' } }),
    mkRow('r5', '한검토2', {
      rq4: { text: '엄상 eae 화', is_correct: false, needs_review: true, feedback: 'OCR 판독 불안정' },
      rq7: { text: 'satisfying → satisfied', is_correct: false, needs_review: true, feedback: '기호 누락' },
    }),
  ]
  return (
    <div className="mx-auto max-w-3xl rounded-xl border bg-white p-4">
      <SubjectiveReviewPanel weekId="sample-week" questions={questions} rows={rows} />
      <p className="mt-4 text-[11px] text-gray-400">
        샘플 5명 × 2문항. 저장 버튼은 실제 API 를 호출하므로 갤러리에선 실패가 정상.
        토글: ⚠️ 행(호박 링) 클릭 → 진한 채움(교사 확정), 재클릭 → 해제. 판정해도 행 순서 고정.
      </p>
    </div>
  )
}

function ExamSheetPreview() {
  const [row, setRow] = useState<GradeRow>(() => ({
    student_id: 's1', student_name: '김테스트', present: true, vocab_correct: null, reading_present: true, reading_correct: null,
    homework_done: null, memo: '',
    // 샘플 답: 대부분 정답, 3·8·13·20 오답, 24 미입력, 21 전원정답, 22 무효
    answers: EXAM_SAMPLE_QUESTIONS.filter((q) => q.question_style === 'objective').map((q) => {
      const wrong = [3, 8, 13, 20].includes(q.question_number)
      const empty = q.question_number === 24
      return { exam_question_id: q.id, student_answer: empty ? null : wrong ? (q.correct_answer % 5) + 1 : q.correct_answer, is_correct: !wrong }
    }),
  }))
  const updateRow = (_: string, key: keyof GradeRow, value: unknown) => setRow((r) => ({ ...r, [key]: value }))
  const updateAnswer = (_: string, questionId: string, value: number | null) =>
    setRow((r) => ({ ...r, answers: r.answers.map((a) => a.exam_question_id === questionId ? { ...a, student_answer: value } : a) }))
  const updateAnswerText = (_: string, questionId: string, text: string) =>
    setRow((r) => {
      const exists = r.answers.some((a) => a.exam_question_id === questionId)
      return {
        ...r,
        answers: exists
          ? r.answers.map((a) => a.exam_question_id === questionId ? { ...a, student_answer_text: text } : a)
          : [...r.answers, { exam_question_id: questionId, student_answer: null, student_answer_text: text }],
      }
    })

  return (
    <div className="mx-auto w-[600px] overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span className="text-base font-semibold">{row.student_name}</span>
        <span className="text-xs text-gray-400">1/12</span>
        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-600">시험</span>
      </div>
      <ExamSheetContent
        weekId="sample-week"
        row={row}
        questions={EXAM_SAMPLE_QUESTIONS}
        readingTotal={EXAM_SAMPLE_QUESTIONS.length}
        updateRow={updateRow}
        updateAnswer={updateAnswer}
        updateAnswerText={updateAnswerText}
      />
    </div>
  )
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
          {tab === 'batch' && <BatchGradePreview />}
          {tab === 'exam' && <ExamSheetPreview />}
          {tab === 'review' && <SubjectiveReviewPreview />}
        </div>
      )}
    </div>
  )
}
