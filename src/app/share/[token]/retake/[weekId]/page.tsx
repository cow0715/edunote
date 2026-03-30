'use client'

import { use, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, XCircle, Send, BookText, RotateCcw } from 'lucide-react'

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

export default function RetakePage({ params }: { params: Promise<{ token: string; weekId: string }> }) {
  const { token, weekId } = use(params)
  const router = useRouter()

  const [isDark, setIsDark] = useState(false)
  const [data, setData] = useState<RetakeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [results, setResults] = useState<GradedResult[] | null>(null)
  const [retakeScore, setRetakeScore] = useState<{ correct: number; total: number } | null>(null)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    const saved = localStorage.getItem('share-theme')
    if (saved) setIsDark(saved === 'dark')
    else setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches)
  }, [])

  useEffect(() => {
    fetch(`/api/share/${token}/retake/${weekId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return }
        setData(d)
        // 이미 재시험 완료면 결과 바로 표시
        if (d.already_retaken) {
          const r: GradedResult[] = d.words.map((w: Word) => ({
            answer_id: w.answer_id,
            english_word: w.english_word,
            retake_answer: w.retake_answer ?? '',
            is_correct: w.retake_is_correct ?? false,
          }))
          setResults(r)
          setRetakeScore({ correct: d.vocab_retake_correct ?? 0, total: d.words.length })
        }
      })
      .catch(() => setError('데이터를 불러올 수 없습니다'))
      .finally(() => setLoading(false))
  }, [token, weekId])

  async function handleSubmit() {
    if (!data) return
    const unanswered = data.words.filter((w) => !(answers[w.answer_id] ?? '').trim())
    if (unanswered.length > 0) {
      // 첫 번째 빈 칸으로 스크롤
      const first = unanswered[0]
      inputRefs.current[first.answer_id]?.focus()
      inputRefs.current[first.answer_id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setSubmitting(true)
    try {
      const payload = data.words.map((w) => ({
        answer_id: w.answer_id,
        english_word: w.english_word,
        retake_answer: answers[w.answer_id] ?? '',
      }))
      const res = await fetch(`/api/share/${token}/retake/${weekId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: payload }),
      })
      const result = await res.json()
      if (result.error) { alert(result.error); return }
      setResults(result.results)
      setRetakeScore({ correct: result.retake_correct, total: result.total })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      alert('제출 중 오류가 발생했습니다')
    } finally {
      setSubmitting(false)
    }
  }

  const answeredCount = data ? data.words.filter((w) => (answers[w.answer_id] ?? '').trim()).length : 0

  const bg = isDark ? 'dark' : ''

  if (loading) return (
    <div className={bg}>
      <div className="min-h-screen bg-gray-50 dark:bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
      </div>
    </div>
  )

  if (error || !data) return (
    <div className={bg}>
      <div className="min-h-screen bg-gray-50 dark:bg-background flex flex-col items-center justify-center gap-3 px-6 text-center">
        <XCircle className="h-12 w-12 text-red-300" />
        <p className="text-sm text-gray-500 dark:text-gray-400">{error ?? '알 수 없는 오류'}</p>
        <button onClick={() => router.back()} className="mt-2 text-sm text-indigo-500 underline">돌아가기</button>
      </div>
    </div>
  )

  const { student, week, words } = data
  const pct = retakeScore ? Math.round(retakeScore.correct / retakeScore.total * 100) : 0

  return (
    <div className={bg}>
      <div className="min-h-screen bg-gray-50 dark:bg-background pb-32">

        {/* ── 헤더 ── */}
        <div className="sticky top-0 z-20 bg-white dark:bg-card border-b border-gray-100 dark:border-white/10 px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-full p-1.5 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors text-gray-500 dark:text-gray-400"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
              {week.class_name} {week.week_number}주차
            </p>
            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
              {student.name} · 단어 재시험
            </p>
          </div>
          <div className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/40 rounded-full px-3 py-1">
            <BookText className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{words.length}개</span>
          </div>
        </div>

        <div className="max-w-lg mx-auto px-4 pt-5 space-y-4">

          {/* ── 결과 화면 ── */}
          {results ? (
            <>
              {/* 점수 카드 */}
              <div className="rounded-2xl bg-white dark:bg-card shadow-sm dark:ring-1 dark:ring-white/10 p-6 text-center">
                <div className={`text-5xl font-black mb-1 ${pct >= 80 ? 'text-emerald-500' : pct >= 60 ? 'text-amber-500' : 'text-rose-500'}`}>
                  {pct}%
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                  {retakeScore!.total}개 중 <strong className="text-gray-900 dark:text-white">{retakeScore!.correct}개</strong> 정답
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {pct >= 80 ? '잘했어요! 꾸준히 복습하면 완벽해질 거예요 💪' :
                   pct >= 60 ? '절반 이상 맞았어요. 틀린 단어를 다시 한번 봐요.' :
                   '괜찮아요. 틀린 단어를 반복 학습해보세요.'}
                </p>
              </div>

              {/* 결과 목록 */}
              <div className="rounded-2xl bg-white dark:bg-card shadow-sm dark:ring-1 dark:ring-white/10 overflow-hidden">
                <div className="px-5 pt-4 pb-2">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">채점 결과</h3>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
                  {results.map((r) => {
                    const word = words.find((w) => w.answer_id === r.answer_id)
                    return (
                      <div key={r.answer_id} className={`px-5 py-3.5 flex items-start gap-3 ${r.is_correct ? '' : 'bg-rose-50/40 dark:bg-rose-950/20'}`}>
                        <div className="mt-0.5 shrink-0">
                          {r.is_correct
                            ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            : <XCircle className="h-4 w-4 text-rose-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{r.english_word}</p>
                          <p className={`text-sm mt-0.5 ${r.is_correct ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                            내 답: {r.retake_answer || '(미작성)'}
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
                </div>
              </div>

              {/* 대시보드 이동 */}
              <button
                type="button"
                onClick={() => router.back()}
                className="w-full rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 transition-colors text-white font-semibold py-4 text-sm shadow-lg shadow-indigo-500/20"
              >
                대시보드로 돌아가기
              </button>
            </>
          ) : (
            <>
              {/* ── 입력 화면 ── */}
              <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
                틀린 단어의 한글 뜻을 입력하세요
              </p>

              <div className="rounded-2xl bg-white dark:bg-card shadow-sm dark:ring-1 dark:ring-white/10 overflow-hidden">
                <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
                  {words.map((w, idx) => {
                    const val = answers[w.answer_id] ?? ''
                    const filled = !!val.trim()
                    return (
                      <div key={w.answer_id} className="px-5 py-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[11px] font-medium text-gray-300 dark:text-gray-600 w-6 text-right shrink-0">
                            {w.number}.
                          </span>
                          <span className="text-base font-semibold text-gray-900 dark:text-white tracking-wide">
                            {w.english_word}
                          </span>
                          {filled && (
                            <span className="ml-auto text-[10px] text-emerald-500 font-medium shrink-0">입력됨</span>
                          )}
                        </div>
                        <input
                          ref={(el) => { inputRefs.current[w.answer_id] = el }}
                          type="text"
                          inputMode="text"
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck={false}
                          placeholder="한글 뜻 입력"
                          value={val}
                          onChange={(e) => setAnswers((prev) => ({ ...prev, [w.answer_id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              // 다음 input으로 포커스
                              const next = words[idx + 1]
                              if (next) inputRefs.current[next.answer_id]?.focus()
                              else (e.target as HTMLInputElement).blur()
                            }
                          }}
                          className="w-full rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 py-3 text-sm text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-600 outline-none focus:border-emerald-400 dark:focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 dark:focus:ring-emerald-900/30 transition-all"
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── 제출 버튼 (입력 화면에서만) ── */}
        {!results && (
          <div className="fixed bottom-0 left-0 right-0 z-20 px-4 pb-6 pt-3 bg-gradient-to-t from-gray-50 dark:from-background via-gray-50/90 dark:via-background/90 to-transparent">
            <div className="max-w-lg mx-auto">
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {answeredCount}/{words.length}개 입력
                </span>
                {answeredCount > 0 && answeredCount < words.length && (
                  <span className="text-xs text-amber-500">{words.length - answeredCount}개 남음</span>
                )}
              </div>
              {/* 진행 바 */}
              <div className="h-1 bg-gray-200 dark:bg-white/10 rounded-full mb-3 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                  style={{ width: `${words.length > 0 ? (answeredCount / words.length) * 100 : 0}%` }}
                />
              </div>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-gray-300 dark:disabled:bg-gray-700 transition-colors text-white font-semibold py-4 text-sm shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    채점 중...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    제출하기
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
