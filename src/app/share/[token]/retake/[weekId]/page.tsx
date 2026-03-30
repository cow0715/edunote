'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, CheckCircle2, ChevronDown, RefreshCw, Timer, XCircle } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type Word = {
  answer_id: string
  number: number
  english_word: string
  correct_answer: string | null
  synonyms: string[] | null
  antonyms: string[] | null
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

type HintState = { sentence: string; translation: string } | 'loading' | 'error'
type Phase = 'loading' | 'playing' | 'grading' | 'revealing' | 'done' | 'practice' | 'practice_done' | 'error'

// ── Component ─────────────────────────────────────────────────────────────────

export default function RetakePage({ params }: { params: Promise<{ token: string; weekId: string }> }) {
  const { token, weekId } = use(params)
  const router = useRouter()

  const [isDark, setIsDark] = useState(false)
  const [data, setData] = useState<RetakeData | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string | null>(null)

  // Game state
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [timeLeft, setTimeLeft] = useState(0)
  const [cardVisible, setCardVisible] = useState(true)
  const [timeExpired, setTimeExpired] = useState(false)

  // Results state
  const [results, setResults] = useState<GradedResult[] | null>(null)
  const [revealCount, setRevealCount] = useState(0)
  const [retakeScore, setRetakeScore] = useState<{ correct: number; total: number } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [hints, setHints] = useState<Record<string, HintState>>({})

  // Practice state
  const [practiceWords, setPracticeWords] = useState<Word[]>([])
  const [practiceAnswers, setPracticeAnswers] = useState<Record<string, string>>({})

  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Effects ─────────────────────────────────────────────────────────────────

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

  // Timer (playing & practice share same logic)
  useEffect(() => {
    if (phase !== 'playing' && phase !== 'practice') return
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
      setRevealCount(0)
      setPhase('revealing')
    } catch {
      alert('제출 중 오류가 발생했습니다')
      setPhase('playing')
    }
  }, [data, answers, token, weekId])

  // Time expire handler
  useEffect(() => {
    if (!timeExpired) return
    setTimeExpired(false)
    if (phase === 'playing') handleSubmit()
    else if (phase === 'practice') setPhase('practice_done')
  }, [timeExpired, phase, handleSubmit])

  // Focus input on card change
  useEffect(() => {
    if ((phase === 'playing' || phase === 'practice') && cardVisible) {
      const t = setTimeout(() => inputRef.current?.focus(), 80)
      return () => clearTimeout(t)
    }
  }, [currentIndex, phase, cardVisible])

  // Auto-reveal results
  useEffect(() => {
    if (phase !== 'revealing' || !results) return
    if (revealCount >= results.length) {
      const t = setTimeout(() => setPhase('done'), 400)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setRevealCount(c => c + 1), 320)
    return () => clearTimeout(t)
  }, [phase, revealCount, results])

  // ── Handlers ────────────────────────────────────────────────────────────────

  const activeWords = phase === 'practice' ? practiceWords : (data?.words ?? [])
  const activeAnswers = phase === 'practice' ? practiceAnswers : answers
  const setActiveAnswers = phase === 'practice'
    ? (fn: (p: Record<string, string>) => Record<string, string>) => setPracticeAnswers(fn)
    : (fn: (p: Record<string, string>) => Record<string, string>) => setAnswers(fn)

  function goNext() {
    setCardVisible(false)
    setTimeout(() => {
      if (currentIndex >= activeWords.length - 1) {
        if (phase === 'practice') {
          clearInterval(timerRef.current!)
          setPhase('practice_done')
        } else {
          handleSubmit()
        }
      } else {
        setCurrentIndex(i => i + 1)
        setCardVisible(true)
      }
    }, 160)
  }

  function startPractice() {
    if (!results) return
    const wrong = results
      .filter(r => !r.is_correct)
      .map(r => data!.words.find(w => w.answer_id === r.answer_id)!)
      .filter(Boolean)
    setPracticeWords(wrong)
    setPracticeAnswers({})
    setCurrentIndex(0)
    setTimeLeft(wrong.length * 30)
    setTimeExpired(false)
    setCardVisible(true)
    setExpandedId(null)
    setPhase('practice')
  }

  function restartPractice() {
    setPracticeAnswers({})
    setCurrentIndex(0)
    setTimeLeft(practiceWords.length * 30)
    setTimeExpired(false)
    setCardVisible(true)
    setPhase('practice')
  }

  function toggleExpand(answerId: string, englishWord: string) {
    const next = expandedId === answerId ? null : answerId
    setExpandedId(next)
    if (next && !hints[answerId]) {
      setHints(p => ({ ...p, [answerId]: 'loading' }))
      fetch(`/api/share/${token}/vocab-hint?word=${encodeURIComponent(englishWord)}`)
        .then(r => r.json())
        .then(d => setHints(p => ({ ...p, [answerId]: d.error ? 'error' : d })))
        .catch(() => setHints(p => ({ ...p, [answerId]: 'error' })))
    }
  }

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

  // ── Computed ─────────────────────────────────────────────────────────────────

  const totalTime = activeWords.length * 30
  const timerPct = totalTime > 0 ? timeLeft / totalTime : 0
  const timerText = timerPct > 0.5 ? 'text-emerald-500' : timerPct > 0.2 ? 'text-amber-500' : 'text-rose-500'
  const timerBg   = timerPct > 0.5 ? 'bg-emerald-500'   : timerPct > 0.2 ? 'bg-amber-400'   : 'bg-rose-500'

  const dark = isDark ? 'dark' : ''

  // ── Render helpers ────────────────────────────────────────────────────────────

  function ScoreGradient({ pct }: { pct: number }) {
    const from = pct >= 80 ? 'from-emerald-500 to-teal-500'
                : pct >= 60 ? 'from-amber-400 to-orange-500'
                : 'from-rose-500 to-pink-500'
    return (
      <div className={`rounded-3xl bg-gradient-to-br ${from} p-6 text-center text-white`}>
        <p className="text-xs font-semibold uppercase tracking-widest opacity-75 mb-2">
          재시험 결과
        </p>
        <p className="text-7xl font-black leading-none mb-2">{pct}%</p>
        {retakeScore && (
          <p className="text-sm opacity-90">
            {retakeScore.total}개 중 <strong>{retakeScore.correct}개</strong> 정답
          </p>
        )}
        <p className="text-xs opacity-75 mt-1.5">
          {pct >= 80 ? '훌륭해요! 꾸준히 복습하면 완벽해질 거예요' :
           pct >= 60 ? '절반 이상 맞았어요. 틀린 단어를 다시 봐요' :
           '괜찮아요. 틀린 단어를 반복 학습해보세요'}
        </p>
      </div>
    )
  }

  function ResultCard({ r }: { r: GradedResult }) {
    const word = data?.words.find(w => w.answer_id === r.answer_id)
    const isExpanded = expandedId === r.answer_id
    const hint = hints[r.answer_id]
    const hasTags = (word?.synonyms?.length ?? 0) > 0 || (word?.antonyms?.length ?? 0) > 0

    return (
      <div className={`rounded-2xl overflow-hidden ring-1 transition-shadow ${
        r.is_correct
          ? 'bg-white dark:bg-card ring-gray-100 dark:ring-white/[0.07]'
          : 'bg-white dark:bg-card ring-rose-100 dark:ring-rose-500/15'
      }`}>
        {/* Main row */}
        <button
          type="button"
          onClick={() => !r.is_correct && toggleExpand(r.answer_id, r.english_word)}
          className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${
            !r.is_correct ? 'cursor-pointer active:bg-gray-50 dark:active:bg-white/5' : 'cursor-default'
          }`}
        >
          <div className="shrink-0">
            {r.is_correct
              ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              : <XCircle className="h-5 w-5 text-rose-400" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-white leading-tight">{r.english_word}</p>
            <p className={`text-sm mt-0.5 ${r.is_correct ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
              {r.retake_answer || '(미작성)'}
            </p>
          </div>
          {!r.is_correct && (
            <ChevronDown className={`h-4 w-4 text-gray-300 dark:text-gray-600 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
          )}
        </button>

        {/* Expandable detail */}
        {!r.is_correct && (
          <div className={`grid transition-all duration-300 ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
              <div className="px-4 pt-1 pb-4 space-y-3.5 border-t border-rose-50 dark:border-rose-500/10">

                {/* 정답 */}
                {word?.correct_answer && (
                  <div>
                    <p className="text-[10px] font-bold text-rose-400 dark:text-rose-500 uppercase tracking-widest mb-1">정답</p>
                    <p className="text-sm font-semibold text-gray-800 dark:text-white">{word.correct_answer}</p>
                  </div>
                )}

                {/* 유의어 */}
                {(word?.synonyms?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-violet-400 dark:text-violet-500 uppercase tracking-widest mb-1.5">유의어</p>
                    <div className="flex flex-wrap gap-1.5">
                      {word!.synonyms!.map(s => (
                        <span key={s} className="px-2.5 py-1 rounded-full bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 text-xs font-medium">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 반의어 */}
                {(word?.antonyms?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-amber-400 dark:text-amber-500 uppercase tracking-widest mb-1.5">반의어</p>
                    <div className="flex flex-wrap gap-1.5">
                      {word!.antonyms!.map(a => (
                        <span key={a} className="px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 text-xs font-medium">
                          {a}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 예문 */}
                <div>
                  <p className="text-[10px] font-bold text-sky-400 dark:text-sky-500 uppercase tracking-widest mb-1.5">예문</p>
                  {hint === 'loading' && (
                    <div className="flex items-center gap-2">
                      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
                      <span className="text-xs text-gray-400 dark:text-gray-500">생성 중...</span>
                    </div>
                  )}
                  {hint === 'error' && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">불러올 수 없습니다</p>
                  )}
                  {hint && hint !== 'loading' && hint !== 'error' && (
                    <div className="space-y-1">
                      <p className="text-sm text-gray-700 dark:text-gray-300 italic leading-relaxed">
                        "{(hint as { sentence: string; translation: string }).sentence}"
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {(hint as { sentence: string; translation: string }).translation}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Phase renders ─────────────────────────────────────────────────────────────

  if (phase === 'loading') return (
    <div className={dark}>
      <div className="min-h-screen bg-slate-50 dark:bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      </div>
    </div>
  )

  if (phase === 'error' || !data) return (
    <div className={dark}>
      <div className="min-h-screen bg-slate-50 dark:bg-background flex flex-col items-center justify-center gap-3 px-6 text-center">
        <XCircle className="h-12 w-12 text-rose-300" />
        <p className="text-sm text-gray-500 dark:text-gray-400">{error ?? '알 수 없는 오류'}</p>
        <button onClick={() => router.back()} className="mt-2 text-sm text-violet-500 underline">돌아가기</button>
      </div>
    </div>
  )

  if (phase === 'grading') return (
    <div className={dark}>
      <div className="min-h-screen bg-slate-50 dark:bg-background flex flex-col items-center justify-center gap-5">
        <div className="relative h-14 w-14">
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          <div className="absolute inset-2 animate-spin rounded-full border-2 border-violet-300 border-b-transparent"
            style={{ animationDirection: 'reverse', animationDuration: '0.7s' }} />
        </div>
        <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 tracking-wide">AI 채점 중...</p>
      </div>
    </div>
  )

  // ── Game UI (playing & practice) ──────────────────────────────────────────────

  if (phase === 'playing' || phase === 'practice') {
    const isPractice = phase === 'practice'
    const currentWord = activeWords[currentIndex]
    const currentAnswer = activeAnswers[currentWord?.answer_id ?? ''] ?? ''
    const accent = isPractice ? {
      ring: 'ring-violet-400 dark:ring-violet-500',
      btn: 'bg-violet-600 hover:bg-violet-700 active:bg-violet-800 shadow-violet-500/25',
      dot: 'bg-violet-500 ring-2 ring-violet-200 dark:ring-violet-900',
      label: 'text-violet-500',
    } : {
      ring: 'ring-indigo-400 dark:ring-indigo-500',
      btn: 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 shadow-indigo-500/25',
      dot: 'bg-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-900',
      label: 'text-indigo-500',
    }

    return (
      <div className={dark}>
        <div className="min-h-[100dvh] bg-slate-50 dark:bg-background flex flex-col select-none">

          {/* Status bar */}
          <div className="shrink-0 bg-white dark:bg-card border-b border-gray-100 dark:border-white/[0.07] px-5 pt-4 pb-3">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5">
                <Timer className={`h-4 w-4 shrink-0 ${timerText}`} />
                <span className={`text-2xl font-black tabular-nums leading-none ${timerText}`}>
                  {formatTime(timeLeft)}
                </span>
                {isPractice && (
                  <span className={`ml-1.5 text-[10px] font-bold ${accent.label} bg-violet-50 dark:bg-violet-950/40 px-2 py-0.5 rounded-full`}>
                    연습
                  </span>
                )}
              </div>
              <span className="text-sm font-medium text-gray-400 dark:text-gray-500 tabular-nums">
                <strong className="text-gray-900 dark:text-white">{currentIndex + 1}</strong> / {activeWords.length}
              </span>
            </div>
            <div className="h-1.5 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-1000 ${timerBg}`}
                style={{ width: `${timerPct * 100}%` }} />
            </div>
          </div>

          {/* Card area */}
          <div className="flex-1 flex flex-col items-center justify-center px-5 gap-7 py-8">

            {/* Progress dots */}
            <div className="flex gap-2 flex-wrap justify-center"
              style={{ maxWidth: Math.min(activeWords.length * 20 + (activeWords.length - 1) * 8, 300) }}>
              {activeWords.map((w, i) => (
                <div key={w.answer_id} className={`rounded-full transition-all duration-200 ${
                  i < currentIndex
                    ? activeAnswers[activeWords[i].answer_id]?.trim()
                      ? 'h-2 w-2 bg-emerald-400'
                      : 'h-2 w-2 bg-gray-300 dark:bg-gray-600'
                    : i === currentIndex
                    ? `h-2.5 w-2.5 ${accent.dot}`
                    : 'h-2 w-2 bg-gray-200 dark:bg-white/10'
                }`} />
              ))}
            </div>

            {/* Word card */}
            <div className={`w-full max-w-sm transition-all duration-150 ${
              cardVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95'
            }`}>
              <div className="bg-white dark:bg-card rounded-3xl shadow-md dark:shadow-none dark:ring-1 dark:ring-white/[0.08] px-8 py-10 text-center">
                <p className="text-[11px] font-bold text-gray-300 dark:text-gray-600 uppercase tracking-widest mb-4">
                  No. {currentWord?.number}
                </p>
                <p className="text-3xl font-black text-gray-900 dark:text-white tracking-wide break-words leading-snug">
                  {currentWord?.english_word}
                </p>
              </div>
            </div>

            {/* Input */}
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
                value={currentAnswer}
                onChange={e => setActiveAnswers(p => ({ ...p, [currentWord.answer_id]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); goNext() } }}
                className={`w-full rounded-2xl border-2 border-gray-200 dark:border-white/[0.1] bg-white dark:bg-card px-5 py-4 text-xl text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-600 outline-none focus:${accent.ring} focus:border-transparent transition-all text-center font-semibold`}
              />
            </div>
          </div>

          {/* Bottom button */}
          <div className="shrink-0 px-5 pb-safe-bottom pb-8 pt-2">
            <button
              type="button"
              onClick={goNext}
              className={`w-full max-w-sm mx-auto flex items-center justify-center gap-2 rounded-2xl ${accent.btn} text-white font-bold py-4 text-base shadow-lg transition-all active:scale-[0.98]`}
            >
              {currentIndex < activeWords.length - 1
                ? <>다음 <ArrowRight className="h-4 w-4" /></>
                : isPractice
                  ? <>연습 완료 <ArrowRight className="h-4 w-4" /></>
                  : <>제출하기 <ArrowRight className="h-4 w-4" /></>}
            </button>
            <p className="text-center text-xs text-gray-300 dark:text-gray-700 mt-2.5">
              Enter 키로도 넘어갈 수 있어요
            </p>
          </div>

        </div>
      </div>
    )
  }

  // ── Practice done ─────────────────────────────────────────────────────────────

  if (phase === 'practice_done') {
    return (
      <div className={dark}>
        <div className="min-h-screen bg-slate-50 dark:bg-background pb-36">
          {/* Header */}
          <div className="bg-white dark:bg-card border-b border-gray-100 dark:border-white/[0.07] px-5 py-6 text-center">
            <p className="text-xs font-bold text-violet-400 dark:text-violet-500 uppercase tracking-widest mb-1">연습 완료</p>
            <p className="text-base font-semibold text-gray-900 dark:text-white">
              틀린 단어 {practiceWords.length}개 복습
            </p>
          </div>

          {/* Comparison list */}
          <div className="max-w-lg mx-auto px-4 pt-4 space-y-2.5">
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 px-1 pb-1">내 답 vs 정답 비교</p>
            {practiceWords.map(w => {
              const myAnswer = practiceAnswers[w.answer_id]?.trim() || '(미작성)'
              return (
                <div key={w.answer_id} className="bg-white dark:bg-card rounded-2xl ring-1 ring-gray-100 dark:ring-white/[0.07] px-4 py-3.5">
                  <p className="text-sm font-bold text-gray-900 dark:text-white mb-2">{w.english_word}</p>
                  <div className="flex gap-3 text-xs">
                    <div className="flex-1 bg-slate-50 dark:bg-white/5 rounded-xl px-3 py-2">
                      <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">내 답</p>
                      <p className="text-gray-700 dark:text-gray-300 font-medium">{myAnswer}</p>
                    </div>
                    <div className="flex-1 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl px-3 py-2">
                      <p className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wide mb-0.5">정답</p>
                      <p className="text-emerald-700 dark:text-emerald-400 font-medium">{w.correct_answer ?? '—'}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Buttons */}
          <div className="fixed bottom-0 left-0 right-0 px-4 pb-8 pt-4 bg-gradient-to-t from-slate-50 dark:from-background via-slate-50/90 dark:via-background/80 to-transparent space-y-2.5">
            <button
              type="button"
              onClick={restartPractice}
              className="w-full max-w-lg mx-auto flex items-center justify-center gap-2 rounded-2xl bg-violet-600 hover:bg-violet-700 active:scale-[0.98] transition-all text-white font-bold py-3.5 text-sm shadow-lg shadow-violet-500/25"
            >
              <RefreshCw className="h-4 w-4" /> 다시 연습하기
            </button>
            <button
              type="button"
              onClick={() => setPhase('done')}
              className="w-full max-w-lg mx-auto flex items-center justify-center rounded-2xl bg-white dark:bg-card hover:bg-gray-50 dark:hover:bg-white/5 active:scale-[0.98] transition-all text-gray-700 dark:text-gray-300 font-semibold py-3.5 text-sm ring-1 ring-gray-200 dark:ring-white/10"
            >
              결과로 돌아가기
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Revealing + Done ──────────────────────────────────────────────────────────

  if ((phase === 'revealing' || phase === 'done') && results) {
    const pct = retakeScore ? Math.round((retakeScore.correct / retakeScore.total) * 100) : 0
    const wrongResults = results.filter(r => !r.is_correct)

    return (
      <div className={dark}>
        <div className="min-h-screen bg-slate-50 dark:bg-background pb-36">
          <div className="max-w-lg mx-auto px-4 pt-5 space-y-4">

            {/* Score card */}
            {phase === 'done'
              ? <ScoreGradient pct={pct} />
              : <div className="rounded-3xl bg-gray-100 dark:bg-white/5 h-44 animate-pulse" />}

            {/* Practice button */}
            {phase === 'done' && wrongResults.length > 0 && (
              <button
                type="button"
                onClick={startPractice}
                className="w-full flex items-center justify-center gap-2 rounded-2xl bg-white dark:bg-card ring-1 ring-violet-200 dark:ring-violet-500/20 text-violet-600 dark:text-violet-400 font-bold py-3.5 text-sm hover:bg-violet-50 dark:hover:bg-violet-950/30 active:scale-[0.98] transition-all"
              >
                <RefreshCw className="h-4 w-4" />
                틀린 {wrongResults.length}개 다시 풀기
              </button>
            )}

            {/* Results */}
            <div className="space-y-2">
              {results.slice(0, revealCount).map(r => (
                <ResultCard key={r.answer_id} r={r} />
              ))}
              {phase === 'revealing' && (
                <div className="flex justify-center py-4">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
                </div>
              )}
            </div>

            {/* Tip */}
            {phase === 'done' && wrongResults.length > 0 && (
              <p className="text-center text-xs text-gray-400 dark:text-gray-600 pb-2">
                오답 카드를 탭하면 뜻·예문·유의어를 볼 수 있어요
              </p>
            )}
          </div>

          {/* Back button */}
          {phase === 'done' && (
            <div className="fixed bottom-0 left-0 right-0 px-4 pb-8 pt-4 bg-gradient-to-t from-slate-50 dark:from-background via-slate-50/90 dark:via-background/80 to-transparent">
              <button
                type="button"
                onClick={() => router.back()}
                className="w-full max-w-lg mx-auto flex items-center justify-center rounded-2xl bg-gray-900 dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-100 active:scale-[0.98] transition-all text-white dark:text-gray-900 font-bold py-4 text-base"
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
