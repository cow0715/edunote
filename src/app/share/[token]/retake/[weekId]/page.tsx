'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { runOrReport } from '@/lib/async-ui'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { ExampleSentenceInline, type ExampleSource } from '@/components/grade/vocab-example-inline'
import { PRESS, PRESS_STRONG, T } from '../../share-tokens'
import { Chevron, CountUp } from '../../share-ui'
import { SHARE_RIGHT_CLASS, SHARE_WRONG_CLASS } from '../../share-word-parts'

// ── Types ─────────────────────────────────────────────────────────────────────

// 재시험 문항 유형. 원 시험지 유형을 그대로 따른다.
//   meaning: 단어(또는 괄호 문장) 보고 한글 뜻 입력
//   blank:   빈칸 문장 보고 영어 단어 입력
//   choice:  [ A / B ] 중 하나 탭
type RetakeKind = 'meaning' | 'blank' | 'choice'

type Word = {
  answer_id: string
  number: number
  english_word: string
  correct_answer: string | null
  test_source?: string | null
  kind?: RetakeKind
  /** 예문 유형일 때 시험지에 나온 문장 */
  prompt_text?: string | null
  /** 선택형 후보 2개 */
  choice_options?: [string, string] | null
  /** 빈칸/선택의 정답 영어 */
  example_answer?: string | null
  synonyms: string[] | null
  antonyms: string[] | null
  example_sentence: string | null
  example_translation: string | null
  retake_answer: string | null
  retake_is_correct: boolean | null
}

const KIND_LABEL: Record<RetakeKind, string> = { meaning: '뜻 쓰기', blank: '빈칸 채우기', choice: '알맞은 단어 고르기' }

/** "I _____ you." 형태를 앞/뒤로 나눈다 (빈칸 카드 렌더용) */
function splitBlank(text: string): [string, string] | null {
  const m = /_{3,}/.exec(text)
  if (!m) return null
  return [text.slice(0, m.index), text.slice(m.index + m[0].length)]
}

type RetakeData = {
  student: { name: string }
  week: { week_number: number; display_label?: string; class_name: string; vocab_total: number }
  score_id: string
  vocab_retake_correct: number | null
  words: Word[]
  completed: boolean
}

type ErrorResponse = { error?: string }

function isRetakeData(value: RetakeData | ErrorResponse): value is RetakeData {
  return 'words' in value && Array.isArray(value.words)
}

type GradedResult = {
  answer_id: string
  english_word: string
  retake_answer: string
  is_correct: boolean
}

type Phase = 'loading' | 'playing' | 'grading' | 'revealing' | 'done' | 'error'

const SECS_PER_WORD = 10

// ── Component ─────────────────────────────────────────────────────────────────
//
// 단어 재시험은 "집중 모드" 다 — 리포트와 달리 헤더·단어 카드를 다크 패널(#191F28)로
// 두고, 그 위에서 타이머와 정답 여부만 파랑/빨강으로 말한다.
// (design_handoff_share_report/README.md "단어 재시험 플로우")

// ── Component ─────────────────────────────────────────────────────────────────

export default function RetakePage({ params }: { params: Promise<{ token: string; weekId: string }> }) {
  const { token, weekId } = use(params)
  const router = useRouter()

  const [data, setData] = useState<RetakeData | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string | null>(null)

  // Game
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [timeLeft, setTimeLeft] = useState(0)
  const [cardVisible, setCardVisible] = useState(true)
  const [timeExpired, setTimeExpired] = useState(false)

  // Results
  const [results, setResults] = useState<GradedResult[] | null>(null)
  const [revealCount, setRevealCount] = useState(0)
  const [retakeScore, setRetakeScore] = useState<{ correct: number; total: number } | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const touchStartX = useRef<number>(0)

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

  async function loadData() {
    setPhase('loading')
    await runOrReport(async () => {
      const d: RetakeData | ErrorResponse = await fetch(`/api/share/${token}/retake/${weekId}`).then(r => r.json())
      if ('error' in d && d.error) { setError(d.error); setPhase('error'); return }
      if (!isRetakeData(d)) { setError('데이터를 불러올 수 없습니다'); setPhase('error'); return }
      setData(d)
      if (d.completed || d.words.length === 0) {
        setPhase('done')
        return
      }
      setAnswers({})
      setCurrentIndex(0)
      setTimeLeft(d.words.length * SECS_PER_WORD)
      setTimeExpired(false)
      setCardVisible(true)
      setResults(null)
      setRevealCount(0)
      setRetakeScore(null)
      setRemaining(null)
      setPhase('playing')
    }, () => {
      setError('데이터를 불러올 수 없습니다')
      setPhase('error')
    })
  }

  // ── Effects ──────────────────────────────────────────────────────────────────

  // 의도적 예외: 마운트 시 데이터 로드. loadData 첫 줄의 setPhase('loading') 이 규칙에 걸린다.
  // 초기 state 가 이미 'loading' 이라 지워도 되지만, 그러면 token/weekId 가 바뀌는 경우
  // 로딩 화면 없이 이전 단어가 남는다. 학부모/학생이 보는 화면이라 동작을 그대로 둔다.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadData() }, [token, weekId])

  useEffect(() => {
    if (phase !== 'playing') return
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current!); setTimeExpired(true); return 0 }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current!)
  }, [phase])

  const handleSubmit = useCallback(async () => {
    if (!data) return
    clearInterval(timerRef.current!)
    // 자동 제출 트리거를 여기서 내린다. (예전에는 effect 안에서 내렸는데,
    // 그러면 effect 본문에서 setState 하는 꼴이 된다. 시점은 동일하다.)
    setTimeExpired(false)
    const payload = data.words.map(w => ({
      answer_id: w.answer_id,
      english_word: w.english_word,
      retake_answer: answers[w.answer_id]?.trim() ?? '',
    }))
    setPhase('grading')
    await runOrReport(async () => {
      const res = await fetch(`/api/share/${token}/retake/${weekId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: payload }),
      })
      const result = await res.json()
      if (result.error) { alert(result.error); setPhase('playing'); return }
      setResults(result.results)
      setRetakeScore({ correct: result.retake_correct, total: result.total })
      setRemaining(result.remaining ?? null)
      setRevealCount(0)
      setPhase('revealing')
    }, () => {
      alert('제출 중 오류가 발생했습니다')
      setPhase('playing')
    })
  }, [data, answers, token, weekId])

  // 의도적 예외: 시간이 다 되면 자동 제출. 플래그는 handleSubmit 첫 줄에서 내린다.
  // 규칙을 피하려면 타이머를 latest-ref 패턴으로 재구성해야 하는데, 시험 시간 계산이
  // 틀리면 학생 답안이 일찍 제출되거나 아예 제출되지 않는다. 위험 대비 이득이 없어 그대로 둔다.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!timeExpired) return
    handleSubmit()
  }, [timeExpired, handleSubmit])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (phase === 'playing' && cardVisible) {
      const t = setTimeout(() => inputRef.current?.focus(), 80)
      return () => clearTimeout(t)
    }
  }, [currentIndex, phase, cardVisible])

  useEffect(() => {
    if (phase !== 'revealing' || !results) return
    if (revealCount >= results.length) {
      const t = setTimeout(() => setPhase('done'), 400)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setRevealCount(c => c + 1), 320)
    return () => clearTimeout(t)
  }, [phase, revealCount, results])

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function goNext() {
    if (!data) return
    if (currentIndex >= data.words.length - 1) {
      // 마지막 단어일 때 확인 다이얼로그
      if (confirm('제출할까요?')) {
        handleSubmit()
      }
      return
    }
    setCardVisible(false)
    setTimeout(() => {
      setCurrentIndex(i => i + 1)
      setCardVisible(true)
    }, 160)
  }

  function goPrev() {
    if (currentIndex <= 0) return
    setCardVisible(false)
    setTimeout(() => {
      setCurrentIndex(i => i - 1)
      setCardVisible(true)
    }, 160)
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const delta = touchStartX.current - e.changedTouches[0].clientX
    if (Math.abs(delta) < 50) return
    if (delta > 0) goNext()
    else goPrev()
  }

  function toggleExpand(answerId: string) {
    setExpandedId(prev => prev === answerId ? null : answerId)
  }

  // ── Computed ──────────────────────────────────────────────────────────────────

  const words = data?.words ?? []
  const totalTime = words.length * SECS_PER_WORD
  const timerPct = totalTime > 0 ? timeLeft / totalTime : 0
  // 남은 시간이 20초 밑으로 떨어지면 빨강 — 색은 "지금 서둘러야 한다" 한 가지 뜻으로만 쓴다
  const timerColor = timeLeft <= 20 ? T.red : T.blue

  // ── Render ────────────────────────────────────────────────────────────────────

  if (phase === 'loading') return (
    <CenterScreen>
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3182F6] border-t-transparent" />
    </CenterScreen>
  )

  if (phase === 'error' || !data) return (
    <CenterScreen>
      <p className="text-[15px] font-bold text-[#191F28]">{error ?? '알 수 없는 오류'}</p>
      <button
        type="button"
        onClick={() => router.back()}
        className={`${PRESS} mt-4 rounded-full bg-[#F2F4F6] px-5 py-2.5 text-[13px] font-bold text-[#4E5968]`}
      >
        돌아가기
      </button>
    </CenterScreen>
  )

  if (phase === 'grading') return (
    <CenterScreen>
      <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#3182F6] border-t-transparent" />
      <p className="mt-4 text-[13px] font-bold text-[#8B95A1]">채점 중...</p>
    </CenterScreen>
  )

  // ── Playing ───────────────────────────────────────────────────────────────────

  if (phase === 'playing') {
    const currentWord = words[currentIndex]
    const isLast = currentIndex >= words.length - 1
    const kicker = currentWord?.kind && currentWord.kind !== 'meaning'
      ? KIND_LABEL[currentWord.kind]
      : currentWord?.prompt_text
        ? '괄호 단어의 뜻'
        : `NO. ${currentWord?.number}`

    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-[430px] flex-col bg-white text-[#191F28] select-none">

        {/* 상단 다크 헤더 — 집중 모드에서만 쓰는 패널 */}
        <div className="shrink-0" style={{ background: T.panel }}>
          <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="나가기"
              className={`${PRESS} flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white`}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[20px] font-black tabular-nums" style={{ color: timerColor }}>
                {formatTime(timeLeft)}
              </span>
              <span className="text-[12px] font-medium tabular-nums text-white/40">/ {formatTime(totalTime)}</span>
            </div>
            <span className="text-[13px] font-bold tabular-nums text-white/50">
              <strong className="text-white">{currentIndex + 1}</strong> / {words.length}
            </span>
          </div>
          {/* 1초 틱과 맞춰 선형으로 줄어든다 */}
          <div className="h-1 bg-white/10">
            <div
              className="h-full transition-[width] duration-1000 ease-linear"
              style={{ width: `${timerPct * 100}%`, background: timerColor }}
            />
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-7 px-5 py-8">

          {/* 진행 점 */}
          <div
            className="flex flex-wrap justify-center gap-2"
            style={{ maxWidth: Math.min(words.length * 20 + (words.length - 1) * 8, 300) }}
          >
            {words.map((w, i) => (
              <span
                key={w.answer_id}
                className={`rounded-full transition-all duration-200 ${i === currentIndex ? 'h-2.5 w-2.5' : 'h-2 w-2'}`}
                style={{
                  background: i === currentIndex
                    ? T.ink
                    : i < currentIndex && answers[w.answer_id]?.trim()
                      ? T.blue
                      : T.disabled2,
                }}
              />
            ))}
          </div>

          {/* 단어 카드 — 다크 */}
          <div
            className={`w-full max-w-sm transition-all duration-150 ${cardVisible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-4 scale-95 opacity-0'}`}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div
              className="relative flex min-h-[168px] flex-col items-center justify-center rounded-[20px] px-12 py-10 text-center"
              style={{ background: T.panel }}
            >
              <button
                type="button"
                onClick={goPrev}
                disabled={currentIndex === 0}
                aria-label="이전 단어"
                className="absolute top-1/2 left-3 -translate-y-1/2 text-white/20 transition-opacity disabled:opacity-0"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>

              <p className="mb-4 text-[11px] font-bold tracking-widest text-white/40">{kicker}</p>

              {currentWord?.kind === 'blank' && currentWord.prompt_text ? (
                // 빈칸: 문장 속 빈칸 자리에 입력 중인 답을 실시간으로 보여준다
                <p className="w-full text-[18px] leading-relaxed font-semibold break-words text-white">
                  {(() => {
                    const parts = splitBlank(currentWord.prompt_text)
                    const typed = answers[currentWord.answer_id]?.trim()
                    if (!parts) return currentWord.prompt_text
                    return (
                      <>
                        {parts[0]}
                        <span
                          className="inline-block min-w-[72px] border-b-2 px-1 text-center"
                          style={{
                            borderColor: typed ? T.blue : 'rgba(255,255,255,0.3)',
                            color: typed ? '#8CC0FF' : undefined,
                          }}
                        >
                          {typed || ' '}
                        </span>
                        {parts[1]}
                      </>
                    )
                  })()}
                </p>
              ) : currentWord?.kind === 'choice' && currentWord.prompt_text ? (
                <p className="w-full text-[18px] leading-relaxed font-semibold break-words text-white">
                  {currentWord.prompt_text.replace(/\[\s*[^\]]+\]/, '[ ? ]')}
                </p>
              ) : currentWord?.prompt_text ? (
                <>
                  <p className="mb-3 w-full text-[15px] leading-relaxed font-medium break-words text-white/70">
                    {currentWord.prompt_text}
                  </p>
                  <p className="w-full text-[26px] leading-snug font-extrabold break-words text-white">
                    {currentWord.english_word}
                  </p>
                </>
              ) : (
                <p className="w-full text-[34px] leading-snug font-extrabold break-words text-white">
                  {currentWord?.english_word}
                </p>
              )}

              <button
                type="button"
                onClick={goNext}
                aria-label={isLast ? '제출' : '다음 단어'}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-white/20 transition-opacity"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </div>
          </div>

          {/* 입력 — 유형별 */}
          <div className={`w-full max-w-sm transition-all delay-[60ms] duration-150 ${cardVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
            {currentWord?.kind === 'choice' && currentWord.choice_options ? (
              // 선택형: 후보 2개 중 탭. 종이의 동그라미 대신 버튼이라 판독 문제가 없다
              <div className="grid grid-cols-2 gap-3">
                {currentWord.choice_options.map((option) => {
                  const selected = answers[currentWord.answer_id] === option
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setAnswers(p => ({ ...p, [currentWord.answer_id]: option }))}
                      className={`${PRESS_STRONG} rounded-[18px] border-2 px-4 py-4 text-[17px] font-bold`}
                      style={selected
                        ? { borderColor: T.blue, background: T.blue, color: '#FFFFFF' }
                        : { borderColor: 'transparent', background: T.box, color: T.body }}
                    >
                      {option}
                    </button>
                  )
                })}
              </div>
            ) : (
              <input
                ref={inputRef}
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize={currentWord?.kind === 'blank' ? 'none' : undefined}
                spellCheck={false}
                placeholder={currentWord?.kind === 'blank' ? '영어 단어를 입력하세요' : '한글 뜻을 입력하세요'}
                value={answers[currentWord?.answer_id ?? ''] ?? ''}
                onChange={e => setAnswers(p => ({ ...p, [currentWord.answer_id]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); goNext() } }}
                className="w-full rounded-[22px] bg-[#F2F4F6] px-5 py-4 text-center text-[17px] font-semibold text-[#191F28] outline-none placeholder:text-[#B0B8C1]"
              />
            )}

            <button
              type="button"
              onClick={goNext}
              className={`${PRESS_STRONG} mt-3 w-full rounded-full py-3.5 text-[15px] font-extrabold text-white`}
              style={{ background: T.blue }}
            >
              {isLast ? '제출 →' : '다음 →'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Revealing + Done ──────────────────────────────────────────────────────────

  if (phase === 'revealing' || phase === 'done') {
    // results 가 없으면 처음 접속부터 이미 완료 상태였던 경우다
    if (phase === 'done' && !results) {
      return (
        <CenterScreen>
          <p className="text-[20px] font-extrabold text-[#191F28]">모든 단어 완료!</p>
          <p className="mt-1.5 text-[13px] text-[#8B95A1]">
            {data.week.class_name} {data.week.display_label ?? `${data.week.week_number}주차`} 단어를 모두 학습했어요
          </p>
          <button
            type="button"
            onClick={() => router.back()}
            className={`${PRESS_STRONG} mt-6 w-full max-w-xs rounded-full py-3.5 text-[15px] font-extrabold text-white`}
            style={{ background: T.blue }}
          >
            오답노트로
          </button>
        </CenterScreen>
      )
    }

    const roundResults = results ?? []
    const pct = retakeScore ? Math.round((retakeScore.correct / retakeScore.total) * 100) : 0
    const allDone = remaining === 0

    return (
      <div className="mx-auto min-h-screen max-w-[430px] bg-white pb-40 text-[#191F28]">
        <div className="flex flex-col gap-3 px-4 pt-5">

          {/* 점수 카드 — 다크 */}
          {phase === 'done' ? (
            <div className="rounded-[20px] px-6 py-8 text-center" style={{ background: T.panel }}>
              <p className="text-[11px] font-bold tracking-widest text-white/40">이번 재시험</p>
              <p className="mt-2 text-[56px] leading-none font-black tabular-nums" style={{ color: T.blue }}>
                <CountUp value={pct} suffix="%" />
              </p>
              <p className="mt-2 text-[14px] tabular-nums text-white/70">
                {retakeScore?.total}개 중 <strong className="text-white">{retakeScore?.correct}개</strong> 정답
              </p>
              {!allDone && remaining !== null && remaining > 0 && (
                <p className="mt-1.5 text-[12px] text-white/40">아직 {remaining}개 남았어요</p>
              )}
            </div>
          ) : (
            <div className="h-44 animate-pulse rounded-[20px] bg-[#F2F4F6]" />
          )}

          {/* 결과 목록 */}
          <div className="flex flex-col gap-2">
            {roundResults.slice(0, revealCount).map((r) => {
              const word = data?.words.find(w => w.answer_id === r.answer_id)
              const isExpanded = expandedId === r.answer_id
              // 예문 유형은 문장이 카드 본문에 이미 있으므로 상세의 예문 박스는 유의어/반의어만
              const showExampleDetail = !!word?.example_sentence && !word?.prompt_text
              const hasDetail = !r.is_correct && !!(word?.synonyms?.length || word?.antonyms?.length || showExampleDetail)

              return (
                <div key={r.answer_id} className="overflow-hidden rounded-[18px] bg-[#F9FAFB]">
                  <button
                    type="button"
                    onClick={() => hasDetail && toggleExpand(r.answer_id)}
                    className={`flex w-full items-center gap-3 px-4 py-3.5 text-left ${hasDetail ? PRESS : 'cursor-default'}`}
                  >
                    <span className="shrink-0 text-[15px] font-black" style={{ color: r.is_correct ? T.blue : T.red }}>
                      {r.is_correct ? '✓' : '✕'}
                    </span>
                    <div className="min-w-0 flex-1">
                      {/* 오답 카드와 같은 뼈대: [문제 그대로] → 내 답 · 정답 */}
                      {word?.prompt_text && (word.kind === 'blank' || word.kind === 'choice') && word.test_source ? (
                        <>
                          <ExampleSentenceInline
                            source={word.test_source as ExampleSource}
                            promptText={word.prompt_text}
                            answer={word.example_answer}
                            studentAnswer={r.retake_answer}
                            isCorrect={r.is_correct}
                            fill="student"
                          />
                          {word.example_translation && (
                            <p className="mt-0.5 text-[11px] leading-4 text-[#8B95A1]">{word.example_translation}</p>
                          )}
                          {!r.is_correct && (
                            <p className="mt-1 text-[13px]">
                              {word.kind === 'choice' && word.choice_options ? (
                                word.choice_options.map((option, index) => {
                                  const isAnswer = option.toLowerCase() === (word.example_answer ?? '').toLowerCase()
                                  const isPicked = !isAnswer && option.toLowerCase() === (r.retake_answer ?? '').toLowerCase()
                                  return (
                                    <span key={index} className={index === 1 ? 'ml-3' : ''}>
                                      <span className={isAnswer ? SHARE_RIGHT_CLASS : isPicked ? SHARE_WRONG_CLASS : 'font-semibold text-[#4E5968]'}>{option}</span>
                                    </span>
                                  )
                                })
                              ) : (
                                <><span className="mr-1 text-[11px] text-[#8B95A1]">정답</span><span className={SHARE_RIGHT_CLASS}>{word.example_answer}</span></>
                              )}
                              <span className="ml-3 text-[#6B7684]"><span className="mr-1 text-[11px] text-[#8B95A1]">{r.english_word}</span>{word.correct_answer}</span>
                            </p>
                          )}
                        </>
                      ) : (
                        <>
                          {/* 뜻쓰기 / 예문뜻: 문제(문장 또는 단어) → 내 답 · 정답 */}
                          {word?.prompt_text && word.test_source ? (
                            <>
                              <ExampleSentenceInline source={word.test_source as ExampleSource} promptText={word.prompt_text} />
                              {word.example_translation && (
                                <p className="mt-0.5 text-[11px] leading-4 text-[#8B95A1]">{word.example_translation}</p>
                              )}
                            </>
                          ) : (
                            <p className="text-[15px] leading-tight font-extrabold">{r.english_word}</p>
                          )}
                          <p className="mt-1 text-[13px]">
                            <span className="mr-1 text-[11px] text-[#8B95A1]">내 답</span>
                            <span className={r.is_correct ? SHARE_RIGHT_CLASS : SHARE_WRONG_CLASS}>{r.retake_answer || '미작성'}</span>
                            {!r.is_correct && word?.correct_answer && (
                              <><span className="mr-1 ml-3 text-[11px] text-[#8B95A1]">정답</span><span className={SHARE_RIGHT_CLASS}>{word.correct_answer}</span></>
                            )}
                            {word?.prompt_text && (
                              <span className="ml-3 text-[11px] text-[#8B95A1]">{r.english_word}</span>
                            )}
                          </p>
                        </>
                      )}
                    </div>
                    {hasDetail && <Chevron open={isExpanded} />}
                  </button>

                  {/* 오답 상세 */}
                  {!r.is_correct && (
                    <div className={`grid transition-all duration-300 ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                      <div className="overflow-hidden">
                        <div className="flex flex-col gap-3 border-t border-[#EEF1F4] px-4 pt-3 pb-4">
                          {(word?.synonyms?.length ?? 0) > 0 && (
                            <div>
                              <p className="mb-1.5 text-[10px] font-bold tracking-widest text-[#8B95A1]">유의어</p>
                              <div className="flex flex-wrap gap-1.5">
                                {word!.synonyms!.map(s => (
                                  <span key={s} className="rounded-full bg-white px-2.5 py-1 text-[12px] font-medium text-[#4E5968]">{s}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {(word?.antonyms?.length ?? 0) > 0 && (
                            <div>
                              <p className="mb-1.5 text-[10px] font-bold tracking-widest text-[#8B95A1]">반의어</p>
                              <div className="flex flex-wrap gap-1.5">
                                {word!.antonyms!.map(a => (
                                  <span key={a} className="rounded-full bg-white px-2.5 py-1 text-[12px] font-medium text-[#4E5968]">{a}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {showExampleDetail && word?.example_sentence && (
                            <div>
                              <p className="mb-1.5 text-[10px] font-bold tracking-widest text-[#8B95A1]">예문</p>
                              <p className="text-[13px] leading-relaxed text-[#333D4B] italic">{word.example_sentence}</p>
                              {word.example_translation && (
                                <p className="mt-0.5 text-[12px] text-[#8B95A1]">{word.example_translation}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {phase === 'revealing' && (
              <div className="flex justify-center py-4">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#3182F6] border-t-transparent" />
              </div>
            )}
          </div>
        </div>

        {/* 하단 버튼 */}
        {phase === 'done' && (
          <div className="fixed inset-x-0 bottom-0 mx-auto flex max-w-[430px] flex-col gap-2.5 bg-gradient-to-t from-white via-white/90 to-transparent px-4 pt-6 pb-8">
            {!allDone && remaining !== null && remaining > 0 && (
              <button
                type="button"
                onClick={loadData}
                className={`${PRESS_STRONG} w-full rounded-full py-3.5 text-[15px] font-extrabold text-white`}
                style={{ background: T.blue }}
              >
                남은 {remaining}개 다시 풀기
              </button>
            )}
            <button
              type="button"
              onClick={() => router.back()}
              className={`${PRESS_STRONG} w-full rounded-full bg-[#F2F4F6] py-3.5 text-[15px] font-extrabold text-[#4E5968]`}
            >
              오답노트로
            </button>
          </div>
        )}
      </div>
    )
  }

  return null
}

/** 로딩·오류·완료처럼 한 덩어리만 가운데 놓는 화면 */
function CenterScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-[430px] flex-col items-center justify-center bg-white px-6 text-center">
      {children}
    </div>
  )
}
