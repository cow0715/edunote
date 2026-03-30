'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, Sparkles, Timer, XCircle } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type Word = {
  answer_id: string
  number: number
  english_word: string
  correct_answer: string | null
  synonyms: string[] | null
  antonyms: string[] | null
  example_sentence: string | null
  example_translation: string | null
  retake_answer: string | null
  retake_is_correct: boolean | null
}

type RetakeData = {
  student: { name: string }
  week: { week_number: number; class_name: string; vocab_total: number }
  score_id: string
  vocab_retake_correct: number | null
  words: Word[]
  completed: boolean
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

export default function RetakePage({ params }: { params: Promise<{ token: string; weekId: string }> }) {
  const { token, weekId } = use(params)
  const router = useRouter()

  const [isDark, setIsDark] = useState(false)
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

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

  async function loadData() {
    setPhase('loading')
    try {
      const d: RetakeData = await fetch(`/api/share/${token}/retake/${weekId}`).then(r => r.json())
      if ((d as any).error) { setError((d as any).error); setPhase('error'); return }
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
    } catch {
      setError('데이터를 불러올 수 없습니다')
      setPhase('error')
    }
  }

  // ── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const saved = localStorage.getItem('share-theme')
    if (saved) setIsDark(saved === 'dark')
    else setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches)
  }, [])

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
    const payload = data.words.map(w => ({
      answer_id: w.answer_id,
      english_word: w.english_word,
      retake_answer: answers[w.answer_id]?.trim() ?? '',
    }))
    setPhase('grading')
    try {
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
    } catch {
      alert('제출 중 오류가 발생했습니다')
      setPhase('playing')
    }
  }, [data, answers, token, weekId])

  useEffect(() => {
    if (!timeExpired) return
    setTimeExpired(false)
    handleSubmit()
  }, [timeExpired, handleSubmit])

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

  function toggleExpand(answerId: string) {
    setExpandedId(prev => prev === answerId ? null : answerId)
  }

  // ── Computed ──────────────────────────────────────────────────────────────────

  const words = data?.words ?? []
  const totalTime = words.length * SECS_PER_WORD
  const timerPct = totalTime > 0 ? timeLeft / totalTime : 0
  const timerText = timerPct > 0.5 ? 'text-emerald-500' : timerPct > 0.2 ? 'text-amber-500' : 'text-rose-500'
  const timerBg   = timerPct > 0.5 ? 'bg-emerald-500'   : timerPct > 0.2 ? 'bg-amber-400'   : 'bg-rose-500'

  const dark = isDark ? 'dark' : ''

  // ── Render ────────────────────────────────────────────────────────────────────

  if (phase === 'loading') return (
    <div className={dark}>
      <div className="min-h-screen bg-gradient-to-b from-[#EBF3FF] to-[#FFFFFF] dark:bg-gradient-to-b dark:from-[#0F172A] dark:to-[#020617] flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      </div>
    </div>
  )

  if (phase === 'error' || !data) return (
    <div className={dark}>
      <div className="min-h-screen bg-gradient-to-b from-[#EBF3FF] to-[#FFFFFF] dark:bg-gradient-to-b dark:from-[#0F172A] dark:to-[#020617] flex flex-col items-center justify-center gap-3 px-6 text-center">
        <XCircle className="h-12 w-12 text-rose-300" />
        <p className="text-sm text-gray-500 dark:text-gray-400">{error ?? '알 수 없는 오류'}</p>
        <button onClick={() => router.back()} className="mt-2 text-sm text-violet-500 underline">돌아가기</button>
      </div>
    </div>
  )

  if (phase === 'grading') return (
    <div className={dark}>
      <div className="min-h-screen bg-gradient-to-b from-[#EBF3FF] to-[#FFFFFF] dark:bg-gradient-to-b dark:from-[#0F172A] dark:to-[#020617] flex flex-col items-center justify-center gap-5">
        <div className="relative h-14 w-14">
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          <div className="absolute inset-2 animate-spin rounded-full border-2 border-violet-300 border-b-transparent"
            style={{ animationDirection: 'reverse', animationDuration: '0.7s' }} />
        </div>
        <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 tracking-wide">AI 채점 중...</p>
      </div>
    </div>
  )

  // ── Playing ───────────────────────────────────────────────────────────────────

  if (phase === 'playing') {
    const currentWord = words[currentIndex]

    return (
      <div className={dark}>
        <div className="min-h-[100dvh] bg-gradient-to-b from-[#EBF3FF] to-[#FFFFFF] dark:bg-gradient-to-b dark:from-[#0F172A] dark:to-[#020617] flex flex-col select-none">

          {/* 상단 상태바 */}
          <div className="shrink-0 bg-white dark:bg-[#1E293B] border-b border-gray-100 dark:border-white/[0.07] px-5 pt-4 pb-3">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => router.back()}
                  className="flex items-center justify-center h-8 w-8 rounded-full bg-gray-100 dark:bg-white/[0.08] text-gray-500 dark:text-gray-400 active:scale-95 transition-transform"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-2">
                  <Timer className={`h-4 w-4 shrink-0 ${timerText}`} />
                  <span className={`text-2xl font-black tabular-nums leading-none ${timerText}`}>
                    {formatTime(timeLeft)}
                  </span>
                  <span className="text-xs text-gray-300 dark:text-gray-600 font-medium">
                    / {formatTime(totalTime)}
                  </span>
                </div>
              </div>
              <span className="text-sm font-medium text-gray-400 dark:text-gray-500 tabular-nums">
                <strong className="text-gray-900 dark:text-white">{currentIndex + 1}</strong>
                <span className="mx-1 text-gray-300 dark:text-gray-600">/</span>
                {words.length}
              </span>
            </div>
            <div className="h-1.5 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-1000 ${timerBg}`}
                style={{ width: `${timerPct * 100}%` }} />
            </div>
          </div>

          {/* 카드 영역 */}
          <div className="flex-1 flex flex-col items-center justify-center px-5 gap-7 py-8">

            {/* 진행 도트 */}
            <div className="flex gap-2 flex-wrap justify-center"
              style={{ maxWidth: Math.min(words.length * 20 + (words.length - 1) * 8, 300) }}>
              {words.map((w, i) => (
                <div key={w.answer_id} className={`rounded-full transition-all duration-200 ${
                  i < currentIndex
                    ? answers[words[i].answer_id]?.trim()
                      ? 'h-2 w-2 bg-emerald-400'
                      : 'h-2 w-2 bg-gray-300 dark:bg-gray-600'
                    : i === currentIndex
                    ? 'h-2.5 w-2.5 bg-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-900'
                    : 'h-2 w-2 bg-gray-200 dark:bg-white/10'
                }`} />
              ))}
            </div>

            {/* 단어 카드 + 네비게이션 */}
            <div className="flex items-center justify-center gap-4 w-full px-3">
              {/* 이전 버튼 */}
              <button
                type="button"
                onClick={goPrev}
                disabled={currentIndex === 0}
                className="flex items-center justify-center h-10 w-10 rounded-full bg-gray-100 dark:bg-white/[0.08] disabled:opacity-30 active:scale-95 transition-all text-gray-700 dark:text-gray-300 shrink-0"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>

              {/* 단어 카드 */}
              <div className={`flex-1 max-w-xs transition-all duration-150 ${
                cardVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95'
              }`}>
                <div className="bg-white dark:bg-[#1E293B] rounded-3xl shadow-[0_10px_40px_rgba(0,75,198,0.03)] dark:shadow-none dark:ring-1 dark:ring-white/[0.08] px-8 py-10 text-center">
                  <p className="text-[11px] font-bold text-gray-300 dark:text-gray-600 uppercase tracking-widest mb-4">
                    No. {currentWord?.number}
                  </p>
                  <p className="text-3xl font-black text-gray-900 dark:text-white tracking-wide break-words leading-snug">
                    {currentWord?.english_word}
                  </p>
                </div>
              </div>

              {/* 다음 버튼 (마지막일 때는 제출 확인) */}
              <button
                type="button"
                onClick={goNext}
                className="flex items-center justify-center h-10 w-10 rounded-full bg-[#2463EB] dark:bg-[#3B82F6] active:scale-95 transition-all text-white shrink-0"
                title={currentIndex >= words.length - 1 ? '제출' : '다음'}
              >
                <ArrowRight className="h-5 w-5" />
              </button>
            </div>

            {/* 입력 */}
            <div className={`w-full max-w-sm transition-all duration-150 delay-[60ms] ${
              cardVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}>
              <input
                ref={inputRef}
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="한글 뜻을 입력하세요"
                value={answers[currentWord?.answer_id ?? ''] ?? ''}
                onChange={e => setAnswers(p => ({ ...p, [currentWord.answer_id]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); goNext() } }}
                className="w-full rounded-2xl border-2 border-gray-200 dark:border-white/[0.1] bg-white dark:bg-[#1E293B] px-5 py-4 text-xl text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-600 outline-none focus:border-indigo-400 dark:focus:border-indigo-500 transition-all text-center font-semibold"
              />
            </div>
          </div>


        </div>
      </div>
    )
  }

  // ── Revealing + Done ──────────────────────────────────────────────────────────

  if (phase === 'revealing' || phase === 'done') {
    // 모든 단어 완료 (results 없음 = 처음 접속부터 완료 상태)
    if (phase === 'done' && !results) {
      return (
        <div className={dark}>
          <div className="min-h-screen bg-gradient-to-b from-[#EBF3FF] to-[#FFFFFF] dark:bg-gradient-to-b dark:from-[#0F172A] dark:to-[#020617] flex flex-col items-center justify-center px-5 gap-6">
            <div className="text-5xl">🎉</div>
            <div className="text-center">
              <p className="text-xl font-black text-gray-900 dark:text-white mb-1">모든 단어 완료!</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {data.week.class_name} {data.week.week_number}주차 단어를 모두 학습했어요
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.back()}
              className="w-full max-w-xs rounded-2xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-bold py-4 text-base active:scale-[0.98] transition-all"
            >
              대시보드로 돌아가기
            </button>
          </div>
        </div>
      )
    }

    const roundResults = results ?? []
    const pct = retakeScore ? Math.round((retakeScore.correct / retakeScore.total) * 100) : 0
    const allCorrectThisRound = retakeScore?.correct === retakeScore?.total
    const allDone = remaining === 0

    const scoreFrom = allCorrectThisRound ? 'from-emerald-500 to-teal-500'
                    : pct >= 60 ? 'from-amber-400 to-orange-500'
                    : 'from-rose-500 to-pink-500'

    return (
      <div className={dark}>
        <div className="min-h-screen bg-gradient-to-b from-[#EBF3FF] to-[#FFFFFF] dark:bg-gradient-to-b dark:from-[#0F172A] dark:to-[#020617] pb-40">
          <div className="max-w-lg mx-auto px-4 pt-5 space-y-3.5">

            {/* 점수 카드 */}
            {phase === 'done' ? (
              <div className={`rounded-3xl bg-gradient-to-br ${scoreFrom} p-6 text-white text-center`}>
                {allDone && (
                  <p className="text-sm font-bold mb-1 opacity-90">🎉 모든 단어 완료!</p>
                )}
                <p className="text-xs font-semibold uppercase tracking-widest opacity-70 mb-2">
                  이번 라운드
                </p>
                <p className="text-6xl font-black leading-none mb-2">{pct}%</p>
                <p className="text-sm opacity-90">
                  {retakeScore?.total}개 중 <strong>{retakeScore?.correct}개</strong> 정답
                </p>
                {!allDone && remaining !== null && remaining > 0 && (
                  <p className="text-xs opacity-75 mt-1.5">아직 {remaining}개 남았어요</p>
                )}
              </div>
            ) : (
              <div className="rounded-3xl bg-gray-100 dark:bg-white/5 h-44 animate-pulse" />
            )}

            {/* 결과 카드 목록 */}
            <div className="space-y-2">
              {roundResults.slice(0, revealCount).map((r) => {
                const word = data?.words.find(w => w.answer_id === r.answer_id)
                const isExpanded = expandedId === r.answer_id
                const hasDetail = !r.is_correct && (word?.synonyms?.length || word?.antonyms?.length || word?.example_sentence)

                return (
                  <div key={r.answer_id} className={`rounded-2xl overflow-hidden ring-1 bg-white dark:bg-[#1E293B] ${
                    r.is_correct
                      ? 'ring-gray-100 dark:ring-white/[0.07]'
                      : 'ring-rose-100 dark:ring-rose-500/15'
                  }`}>
                    <button
                      type="button"
                      onClick={() => hasDetail && toggleExpand(r.answer_id)}
                      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${
                        hasDetail ? 'active:bg-gray-50 dark:active:bg-white/5' : 'cursor-default'
                      }`}
                    >
                      <div className="shrink-0">
                        {r.is_correct
                          ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                          : <XCircle className="h-5 w-5 text-rose-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white leading-tight">{r.english_word}</p>
                        {!r.is_correct && word?.correct_answer && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 leading-tight">{word.correct_answer}</p>
                        )}
                        <p className={`text-sm mt-0.5 ${r.is_correct ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                          {r.retake_answer || '(미작성)'}
                        </p>
                      </div>
                      {hasDetail && (
                        <ChevronDown className={`h-4 w-4 text-gray-300 dark:text-gray-600 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                      )}
                    </button>

                    {/* 오답 상세 */}
                    {!r.is_correct && (
                      <div className={`grid transition-all duration-300 ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                        <div className="overflow-hidden">
                          <div className="px-4 pt-1 pb-4 space-y-3 border-t border-rose-50 dark:border-rose-500/10">
                            {(word?.synonyms?.length ?? 0) > 0 && (
                              <div>
                                <p className="text-[10px] font-bold text-violet-400 uppercase tracking-widest mb-1.5">유의어</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {word!.synonyms!.map(s => (
                                    <span key={s} className="px-2.5 py-1 rounded-full bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 text-xs font-medium">{s}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {(word?.antonyms?.length ?? 0) > 0 && (
                              <div>
                                <p className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-1.5">반의어</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {word!.antonyms!.map(a => (
                                    <span key={a} className="px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 text-xs font-medium">{a}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {word?.example_sentence && (
                              <div>
                                <p className="text-[10px] font-bold text-sky-400 uppercase tracking-widest mb-1.5">예문</p>
                                <div className="space-y-1">
                                  <p className="text-sm text-gray-700 dark:text-gray-300 italic leading-relaxed">
                                    "{word.example_sentence}"
                                  </p>
                                  {word.example_translation && (
                                    <p className="text-xs text-gray-400 dark:text-gray-500">{word.example_translation}</p>
                                  )}
                                </div>
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
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
                </div>
              )}
            </div>
          </div>

          {/* 하단 버튼 */}
          {phase === 'done' && (
            <div className="fixed bottom-0 left-0 right-0 px-4 pb-8 pt-4 space-y-2.5 bg-gradient-to-t from-slate-50 dark:from-background via-slate-50/90 dark:via-background/80 to-transparent">
              {!allDone && remaining !== null && remaining > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={loadData}
                    className="w-full max-w-lg mx-auto flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] transition-all text-white font-bold py-4 text-base shadow-lg shadow-indigo-500/25"
                  >
                    <Sparkles className="h-4 w-4" />
                    다음 라운드 ({remaining}개 남음)
                  </button>
                  <button
                    type="button"
                    onClick={() => router.back()}
                    className="w-full max-w-lg mx-auto flex items-center justify-center rounded-2xl bg-white dark:bg-[#1E293B] ring-1 ring-gray-200 dark:ring-white/10 text-gray-600 dark:text-gray-400 font-semibold py-3.5 text-sm active:scale-[0.98] transition-all"
                  >
                    대시보드로 돌아가기
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => router.back()}
                  className="w-full max-w-lg mx-auto flex items-center justify-center rounded-2xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-bold py-4 text-base active:scale-[0.98] transition-all"
                >
                  대시보드로 돌아가기
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return null
}
