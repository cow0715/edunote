'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, CheckCircle2, Timer, XCircle } from 'lucide-react'

type Word = {
  answer_id: string
  number: number
  english_word: string
  correct_answer: string | null
  retake_answer: string | null
  retake_is_correct: boolean | null
}

type RetakeData = {
  student: { name: string }
  week: { week_number: number; class_name: string; vocab_total: number }
  score_id: string
  vocab_retake_correct: number | null
  words: Word[]
  already_retaken: boolean
}

type GradedResult = {
  answer_id: string
  english_word: string
  retake_answer: string
  is_correct: boolean
}

type Phase = 'loading' | 'playing' | 'grading' | 'revealing' | 'done' | 'error'

export default function RetakePage({ params }: { params: Promise<{ token: string; weekId: string }> }) {
  const { token, weekId } = use(params)
  const router = useRouter()

  const [isDark, setIsDark] = useState(false)
  const [data, setData] = useState<RetakeData | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string | null>(null)

  // Playing
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [timeLeft, setTimeLeft] = useState(0)
  const [cardVisible, setCardVisible] = useState(true)
  const [timeExpired, setTimeExpired] = useState(false)

  // Results
  const [results, setResults] = useState<GradedResult[] | null>(null)
  const [revealCount, setRevealCount] = useState(0)
  const [retakeScore, setRetakeScore] = useState<{ correct: number; total: number } | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('share-theme')
    if (saved) setIsDark(saved === 'dark')
    else setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches)
  }, [])

  useEffect(() => {
    fetch(`/api/share/${token}/retake/${weekId}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setPhase('error'); return }
        setData(d)
        if (d.already_retaken) {
          const r: GradedResult[] = d.words.map((w: Word) => ({
            answer_id: w.answer_id,
            english_word: w.english_word,
            retake_answer: w.retake_answer ?? '',
            is_correct: w.retake_is_correct ?? false,
          }))
          setResults(r)
          setRetakeScore({ correct: d.vocab_retake_correct ?? 0, total: d.words.length })
          setRevealCount(r.length)
          setPhase('done')
        } else {
          setTimeLeft(d.words.length * 30)
          setPhase('playing')
        }
      })
      .catch(() => { setError('데이터를 불러올 수 없습니다'); setPhase('error') })
  }, [token, weekId])

  // Timer
  useEffect(() => {
    if (phase !== 'playing') return
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current!)
          setTimeExpired(true)
          return 0
        }
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
      setRevealCount(0)
      setPhase('revealing')
    } catch {
      alert('제출 중 오류가 발생했습니다')
      setPhase('playing')
    }
  }, [data, answers, token, weekId])

  // Auto-submit on time expiry
  useEffect(() => {
    if (timeExpired) handleSubmit()
  }, [timeExpired, handleSubmit])

  // Focus input when card changes
  useEffect(() => {
    if (phase === 'playing' && cardVisible) {
      const t = setTimeout(() => inputRef.current?.focus(), 80)
      return () => clearTimeout(t)
    }
  }, [currentIndex, phase, cardVisible])

  // Auto-reveal results one by one
  useEffect(() => {
    if (phase !== 'revealing' || !results) return
    if (revealCount >= results.length) {
      const t = setTimeout(() => setPhase('done'), 400)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setRevealCount(c => c + 1), 350)
    return () => clearTimeout(t)
  }, [phase, revealCount, results])

  function goNext() {
    if (!data) return
    setCardVisible(false)
    setTimeout(() => {
      if (currentIndex >= data.words.length - 1) {
        handleSubmit()
      } else {
        setCurrentIndex(i => i + 1)
        setCardVisible(true)
      }
    }, 160)
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const dark = isDark ? 'dark' : ''

  // ── Loading ──
  if (phase === 'loading') return (
    <div className={dark}>
      <div className="min-h-screen bg-gray-50 dark:bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
      </div>
    </div>
  )

  // ── Error ──
  if (phase === 'error' || !data) return (
    <div className={dark}>
      <div className="min-h-screen bg-gray-50 dark:bg-background flex flex-col items-center justify-center gap-3 px-6 text-center">
        <XCircle className="h-12 w-12 text-red-300" />
        <p className="text-sm text-gray-500 dark:text-gray-400">{error ?? '알 수 없는 오류'}</p>
        <button onClick={() => router.back()} className="mt-2 text-sm text-indigo-500 underline">돌아가기</button>
      </div>
    </div>
  )

  const { words } = data
  const currentWord = words[currentIndex]
  const totalTime = words.length * 30
  const timerPct = totalTime > 0 ? timeLeft / totalTime : 0
  const timerColorText = timerPct > 0.5 ? 'text-emerald-500' : timerPct > 0.2 ? 'text-amber-500' : 'text-rose-500'
  const timerColorBg = timerPct > 0.5 ? 'bg-emerald-500' : timerPct > 0.2 ? 'bg-amber-500' : 'bg-rose-500'

  // ── Grading ──
  if (phase === 'grading') return (
    <div className={dark}>
      <div className="min-h-screen bg-gray-50 dark:bg-background flex flex-col items-center justify-center gap-5">
        <div className="relative h-14 w-14">
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          <div className="absolute inset-2 animate-spin rounded-full border-2 border-indigo-300 border-b-transparent" style={{ animationDirection: 'reverse', animationDuration: '0.7s' }} />
        </div>
        <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 tracking-wide">AI 채점 중...</p>
      </div>
    </div>
  )

  // ── Playing ──
  if (phase === 'playing') {
    const progress = (currentIndex / words.length) * 100
    return (
      <div className={dark}>
        <div className="min-h-[100dvh] bg-gray-50 dark:bg-background flex flex-col select-none">

          {/* ── 상단 상태바 ── */}
          <div className="shrink-0 bg-white dark:bg-card border-b border-gray-100 dark:border-white/10 px-5 pt-safe-top pt-4 pb-3">
            <div className="flex items-center justify-between mb-2.5">
              {/* 타이머 */}
              <div className="flex items-center gap-1.5">
                <Timer className={`h-4 w-4 shrink-0 ${timerColorText}`} />
                <span className={`text-2xl font-black tabular-nums leading-none ${timerColorText}`}>
                  {formatTime(timeLeft)}
                </span>
              </div>
              {/* 진행 */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">
                  {currentIndex + 1}
                </span>
                <span className="text-sm text-gray-300 dark:text-gray-600">/</span>
                <span className="text-sm text-gray-400 dark:text-gray-500 tabular-nums">
                  {words.length}
                </span>
              </div>
            </div>
            {/* 타이머 바 */}
            <div className="h-1.5 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 linear ${timerColorBg}`}
                style={{ width: `${timerPct * 100}%` }}
              />
            </div>
          </div>

          {/* ── 카드 영역 ── */}
          <div className="flex-1 flex flex-col items-center justify-center px-5 gap-6 py-8">

            {/* 진행 도트 */}
            <div className="flex gap-2 flex-wrap justify-center" style={{ maxWidth: Math.min(words.length * 18, 280) }}>
              {words.map((w, i) => (
                <div
                  key={w.answer_id}
                  className={`rounded-full transition-all duration-200 ${
                    i < currentIndex
                      ? answers[words[i].answer_id]?.trim()
                        ? 'h-2 w-2 bg-emerald-400'
                        : 'h-2 w-2 bg-gray-300 dark:bg-gray-600'
                      : i === currentIndex
                      ? 'h-2.5 w-2.5 bg-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-900'
                      : 'h-2 w-2 bg-gray-200 dark:bg-white/10'
                  }`}
                />
              ))}
            </div>

            {/* 단어 카드 */}
            <div
              className={`w-full max-w-sm transition-all duration-160 ${
                cardVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-3 scale-95'
              }`}
            >
              <div className="bg-white dark:bg-card rounded-3xl shadow-md dark:shadow-none dark:ring-1 dark:ring-white/10 px-8 py-10 text-center">
                <p className="text-[11px] font-semibold text-gray-300 dark:text-gray-600 uppercase tracking-widest mb-4">
                  단어 {currentWord.number}
                </p>
                <p className="text-3xl font-black text-gray-900 dark:text-white tracking-wide break-words leading-snug">
                  {currentWord.english_word}
                </p>
              </div>
            </div>

            {/* 입력 */}
            <div
              className={`w-full max-w-sm transition-all duration-160 delay-75 ${
                cardVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
              }`}
            >
              <input
                ref={inputRef}
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="한글 뜻을 입력하세요"
                value={answers[currentWord.answer_id] ?? ''}
                onChange={e => setAnswers(prev => ({ ...prev, [currentWord.answer_id]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); goNext() } }}
                className="w-full rounded-2xl border-2 border-gray-200 dark:border-white/10 bg-white dark:bg-card px-5 py-4 text-xl text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-600 outline-none focus:border-indigo-400 dark:focus:border-indigo-500 transition-colors text-center font-semibold"
              />
            </div>
          </div>

          {/* ── 하단 버튼 ── */}
          <div className="shrink-0 px-5 pb-8 pt-2">
            <button
              type="button"
              onClick={goNext}
              className="w-full max-w-sm mx-auto flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] transition-all text-white font-bold py-4 text-base shadow-lg shadow-indigo-500/25"
            >
              {currentIndex < words.length - 1 ? (
                <>다음 <ArrowRight className="h-4 w-4" /></>
              ) : (
                <>제출하기 <ArrowRight className="h-4 w-4" /></>
              )}
            </button>
            <p className="text-center text-xs text-gray-300 dark:text-gray-600 mt-2.5">
              Enter 키로도 넘어갈 수 있어요
            </p>
          </div>

        </div>
      </div>
    )
  }

  // ── Revealing + Done ──
  if ((phase === 'revealing' || phase === 'done') && results) {
    const pct = retakeScore ? Math.round((retakeScore.correct / retakeScore.total) * 100) : 0
    const pctColor = pct >= 80 ? 'text-emerald-500' : pct >= 60 ? 'text-amber-500' : 'text-rose-500'
    const pctMsg =
      pct >= 80 ? '잘했어요! 꾸준히 복습하면 완벽해질 거예요 💪' :
      pct >= 60 ? '절반 이상 맞았어요. 틀린 단어를 다시 한번 봐요.' :
      '괜찮아요. 틀린 단어를 반복 학습해보세요.'

    return (
      <div className={dark}>
        <div className="min-h-screen bg-gray-50 dark:bg-background pb-36">

          {/* 점수 헤더 */}
          <div className="bg-white dark:bg-card border-b border-gray-100 dark:border-white/10 px-5 pt-8 pb-6 text-center">
            <p className="text-xs font-semibold text-gray-300 dark:text-gray-600 uppercase tracking-widest mb-3">채점 결과</p>
            <div className={`text-6xl font-black mb-2 transition-all duration-500 ${phase === 'done' ? pctColor : 'text-gray-200 dark:text-white/10'}`}>
              {phase === 'done' ? `${pct}%` : '...'}
            </div>
            {phase === 'done' && retakeScore && (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {retakeScore.total}개 중 <strong className="text-gray-900 dark:text-white">{retakeScore.correct}개</strong> 정답
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">{pctMsg}</p>
              </>
            )}
          </div>

          {/* 결과 카드 */}
          <div className="max-w-lg mx-auto px-4 pt-4 space-y-2.5">
            {results.slice(0, revealCount).map((r) => {
              const word = words.find(w => w.answer_id === r.answer_id)
              return (
                <div
                  key={r.answer_id}
                  className={`rounded-2xl px-4 py-3.5 flex items-center gap-3 ring-1 transition-all ${
                    r.is_correct
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 ring-emerald-200 dark:ring-emerald-500/20'
                      : 'bg-rose-50 dark:bg-rose-950/30 ring-rose-200 dark:ring-rose-500/20'
                  }`}
                >
                  <div className="shrink-0">
                    {r.is_correct
                      ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      : <XCircle className="h-5 w-5 text-rose-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{r.english_word}</p>
                    <p className={`text-sm ${r.is_correct ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                      {r.retake_answer || '(미작성)'}
                    </p>
                    {!r.is_correct && word?.correct_answer && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        정답: {word.correct_answer}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}

            {phase === 'revealing' && (
              <div className="flex justify-center py-6">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
              </div>
            )}
          </div>

          {/* 돌아가기 버튼 */}
          {phase === 'done' && (
            <div className="fixed bottom-0 left-0 right-0 px-4 pb-8 pt-4 bg-gradient-to-t from-gray-50 dark:from-background via-gray-50/90 dark:via-background/80 to-transparent">
              <button
                type="button"
                onClick={() => router.back()}
                className="w-full max-w-lg mx-auto flex items-center justify-center rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] transition-all text-white font-bold py-4 text-base shadow-lg shadow-indigo-500/25"
              >
                대시보드로 돌아가기
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return null
}
