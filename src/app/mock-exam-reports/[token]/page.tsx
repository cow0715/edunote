import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'

type Snapshot = {
  generated_at: string
  exam: {
    title: string
    exam_year: number
    exam_month: number
    grade: number | null
    source: string
    exam_date: string | null
  }
  student: {
    name: string
    school: string | null
    grade: string | null
  }
  score: {
    raw_score: number | null
    grade: number | null
    listening_correct: number
    listening_total: number
    reading_correct: number
    reading_total: number
    type_analysis: Record<string, {
      correct?: number
      total?: number
      earned?: number
      points?: number
      accuracy?: number | null
      score_rate?: number | null
    }>
  }
  cohort?: {
    rank: number | null
    total: number
    average_score: number | null
    top_score: number | null
    same_score_count: number
    percentile: number | null
  } | null
  wrong_answers: {
    student_answer: string | null
    earned_points: number
    mock_exam_question: {
      question_number: number
      correct_answer: string
      points: number
      section: string
      question_type: string
      difficulty: string
    } | null
  }[]
  teacher_comment: string | null
}

function rate(correct: number, total: number) {
  if (!total) return '-'
  return `${Math.round((correct / total) * 100)}%`
}

function percent(correct: number, total: number) {
  if (!total) return null
  return Math.round((correct / total) * 100)
}

function nextGradeGap(score: number | null, grade: number | null) {
  if (score == null || grade == null || grade <= 1) return null
  const nextCutoffs: Record<number, number> = {
    2: 90,
    3: 80,
    4: 70,
    5: 60,
    6: 50,
    7: 40,
    8: 30,
    9: 20,
  }
  const cutoff = nextCutoffs[grade]
  if (!cutoff) return null
  return Math.max(0, cutoff - score)
}

function boundedPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return 0
  return Math.max(0, Math.min(100, Math.round(Number(value))))
}

function performanceTone(value: number | null | undefined) {
  const score = boundedPercent(value)
  if (score >= 80) return {
    label: '안정',
    chip: 'bg-blue-50 text-[#2463EB]',
    bar: 'bg-[#2463EB]',
    tile: 'bg-white',
  }
  if (score >= 60) return {
    label: '점검',
    chip: 'bg-amber-50 text-amber-600',
    bar: 'bg-amber-400',
    tile: 'bg-amber-50',
  }
  return {
    label: '우선',
    chip: 'bg-red-50 text-[#FF4D4D]',
    bar: 'bg-[#FF4D4D]',
    tile: 'bg-red-50',
  }
}

function questionRangeLabel(questionNumber: number) {
  if (questionNumber <= 17) return '듣기'
  if (questionNumber <= 30) return '독해 전반'
  if (questionNumber <= 40) return '독해 중후반'
  return '고난도 후반'
}

export default async function MockExamReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createServiceClient()
  const { data: report } = await supabase
    .from('mock_exam_report')
    .select('snapshot_json, published_at, status, revoked_at')
    .eq('share_token', token)
    .eq('status', 'published')
    .is('revoked_at', null)
    .single()

  if (!report) notFound()

  const snapshot = report.snapshot_json as Snapshot
  const typeEntries = Object.entries(snapshot.score.type_analysis ?? {})
    .sort(([, a], [, b]) => (Number(a.accuracy ?? 100) - Number(b.accuracy ?? 100)))
  const wrongAnswers = snapshot.wrong_answers ?? []
  const lostPoints = wrongAnswers.reduce((sum, answer) => sum + Number(answer.mock_exam_question?.points ?? 0), 0)
  const threePointWrong = wrongAnswers.filter((answer) => Number(answer.mock_exam_question?.points ?? 0) >= 3)
  const listeningAccuracy = percent(snapshot.score.listening_correct, snapshot.score.listening_total)
  const readingAccuracy = percent(snapshot.score.reading_correct, snapshot.score.reading_total)
  const gradeGap = nextGradeGap(snapshot.score.raw_score, snapshot.score.grade)
  const typeRows = typeEntries
    .map(([type, value]) => {
      const correct = Number(value.correct ?? 0)
      const total = Number(value.total ?? 0)
      const earned = Number(value.earned ?? 0)
      const points = Number(value.points ?? 0)
      const scoreRate = value.score_rate ?? value.accuracy ?? null
      const lost = Math.max(0, points - earned)
      return {
        type,
        correct,
        total,
        earned,
        points,
        accuracy: value.accuracy,
        scoreRate,
        lost,
        tone: performanceTone(scoreRate),
      }
    })
    .filter((item) => item.total > 0)
    .sort((a, b) => b.lost - a.lost || boundedPercent(a.scoreRate) - boundedPercent(b.scoreRate))
  const weakTypes = typeRows
    .filter((item) => item.lost > 0)
    .sort((a, b) => b.lost - a.lost || boundedPercent(a.scoreRate) - boundedPercent(b.scoreRate))
  const strongTypes = typeRows
    .filter((item) => item.lost === 0 || boundedPercent(item.scoreRate) >= 80)
    .sort((a, b) => boundedPercent(b.scoreRate) - boundedPercent(a.scoreRate) || b.total - a.total)
    .slice(0, 2)
  const priorityTypes = weakTypes.slice(0, 3)
  const wrongTypeSummary = weakTypes.slice(0, 4)
  const highImpactWrong = wrongAnswers
    .slice()
    .sort((a, b) => Number(b.mock_exam_question?.points ?? 0) - Number(a.mock_exam_question?.points ?? 0))
    .slice(0, 5)
  const wrongByQuestion = new Map(
    wrongAnswers
      .filter((answer) => answer.mock_exam_question?.question_number)
      .map((answer) => [answer.mock_exam_question!.question_number, answer]),
  )
  const questionMap = Array.from({ length: 45 }, (_, index) => {
    const questionNumber = index + 1
    const wrong = wrongByQuestion.get(questionNumber)
    return {
      questionNumber,
      wrong,
      points: Number(wrong?.mock_exam_question?.points ?? 0),
    }
  })
  const wrongByRange = wrongAnswers.reduce<Record<string, number>>((acc, answer) => {
    const questionNumber = answer.mock_exam_question?.question_number
    if (!questionNumber) return acc
    const label = questionRangeLabel(questionNumber)
    acc[label] = (acc[label] ?? 0) + 1
    return acc
  }, {})
  const primaryFocus = priorityTypes[0]
  const typeSummary = typeRows.length > 0
    ? `${typeRows.length}개 유형 중 ${weakTypes.length}개 유형에서 점수 손실`
    : '유형 데이터 없음'

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#EBF3FF] to-white px-4 py-8 text-[#1A1C1E]">
      <div className="mx-auto max-w-5xl space-y-5">
        <section className="rounded-[24px] bg-white p-6 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#2463EB]">추지혜 영어 모의고사 성적표</p>
              <h1 className="mt-2 text-2xl font-extrabold md:text-3xl">{snapshot.exam.title}</h1>
              <p className="mt-2 text-sm text-[#8B95A1]">
                {snapshot.exam.exam_year}년 {snapshot.exam.exam_month}월 · {snapshot.exam.source}
                {snapshot.exam.exam_date ? ` · ${snapshot.exam.exam_date}` : ''}
              </p>
            </div>
            <div className="w-full rounded-[24px] bg-blue-50 p-5 md:w-[320px]">
              <p className="text-xl font-extrabold text-[#1A1C1E]">{snapshot.student.name}</p>
              <p className="mt-1 text-sm font-bold text-[#8B95A1]">
                {[snapshot.student.school, snapshot.student.grade].filter(Boolean).join(' · ') || '학생 성적'}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white p-4">
                  <p className="text-xs font-bold text-[#8B95A1]">점수</p>
                  <p className="mt-1 text-4xl font-extrabold text-[#2463EB]">{snapshot.score.raw_score ?? '-'}</p>
                  <p className="mt-1 text-xs font-bold text-[#8B95A1]">점</p>
                </div>
                <div className="rounded-2xl bg-white p-4 text-right">
                  <p className="text-xs font-bold text-[#8B95A1]">등급</p>
                  <p className="mt-1 text-4xl font-extrabold text-[#1A1C1E]">{snapshot.score.grade ?? '-'}</p>
                  <p className="mt-1 text-xs font-bold text-[#8B95A1]">등급</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-[24px] bg-white p-5 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
            <p className="text-sm text-[#8B95A1]">듣기 정답률</p>
            <p className="mt-2 text-2xl font-extrabold text-[#2463EB]">
              {rate(snapshot.score.listening_correct, snapshot.score.listening_total)}
            </p>
            <p className="mt-1 text-xs text-[#8B95A1]">
              {snapshot.score.listening_correct}/{snapshot.score.listening_total}
            </p>
          </div>
          <div className="rounded-[24px] bg-white p-5 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
            <p className="text-sm text-[#8B95A1]">독해 정답률</p>
            <p className="mt-2 text-2xl font-extrabold text-[#2463EB]">
              {rate(snapshot.score.reading_correct, snapshot.score.reading_total)}
            </p>
            <p className="mt-1 text-xs text-[#8B95A1]">
              {snapshot.score.reading_correct}/{snapshot.score.reading_total}
            </p>
          </div>
          <div className="rounded-[24px] bg-white p-5 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
            <p className="text-sm text-[#8B95A1]">오답 문항</p>
            <p className="mt-2 text-2xl font-extrabold text-[#FF4D4D]">{snapshot.wrong_answers.length}개</p>
            <p className="mt-1 text-xs text-[#8B95A1]">발행일 {new Date(report.published_at).toLocaleDateString('ko-KR')}</p>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
          <div className="rounded-[24px] bg-white p-5 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold">1~45 오답 맵</h2>
                <p className="mt-1 text-sm font-medium text-[#8B95A1]">붉은 번호는 오답, 진한 번호는 3점 문항</p>
              </div>
              <span className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-extrabold text-[#FF4D4D]">
                {wrongAnswers.length}/45
              </span>
            </div>

            <div className="mt-4 grid grid-cols-9 gap-1.5">
              {questionMap.map((item) => (
                <div
                  key={item.questionNumber}
                  className={[
                    'flex h-8 items-center justify-center rounded-xl text-xs font-extrabold',
                    item.wrong
                      ? item.points >= 3
                        ? 'bg-[#FF4D4D] text-white'
                        : 'bg-red-50 text-[#FF4D4D]'
                      : 'bg-slate-50 text-slate-300',
                  ].join(' ')}
                  title={item.wrong ? `${item.questionNumber}번 ${item.wrong.mock_exam_question?.question_type ?? ''}` : `${item.questionNumber}번`}
                >
                  {item.questionNumber}
                </div>
              ))}
            </div>

            {wrongAnswers.length === 0 ? (
              <div className="mt-4 rounded-2xl bg-blue-50 p-4 text-sm font-bold text-[#2463EB]">
                오답 문항이 없습니다.
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                {Object.entries(wrongByRange).map(([label, count]) => (
                  <div key={label} className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-xs font-bold text-[#8B95A1]">{label}</p>
                    <p className="mt-1 text-lg font-extrabold text-[#1A1C1E]">{count}문항</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[24px] bg-[#1A1C1E] p-5 text-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
            <h2 className="text-lg font-extrabold">복습 우선순위</h2>
            <p className="mt-1 text-sm font-medium text-slate-300">고배점 오답과 점수 손실이 큰 유형</p>
            {highImpactWrong.length === 0 ? (
              <p className="mt-4 rounded-2xl bg-white/10 p-4 text-sm font-medium text-slate-300">고배점 오답이 없습니다.</p>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {highImpactWrong.map((answer) => (
                  <span
                    key={answer.mock_exam_question?.question_number}
                    className="rounded-full bg-white/10 px-3 py-2 text-xs font-extrabold text-white"
                  >
                    {answer.mock_exam_question?.question_number}번 · {answer.mock_exam_question?.points}점 · {answer.mock_exam_question?.question_type}
                  </span>
                ))}
              </div>
            )}

            {wrongTypeSummary.length > 0 && (
              <div className="mt-4 space-y-2">
                {wrongTypeSummary.map((item) => (
                  <div key={item.type} className="flex items-center justify-between gap-3 rounded-2xl bg-white/10 px-3 py-2 text-xs">
                    <span className="min-w-0 truncate font-bold">{item.type}</span>
                    <span className="shrink-0 font-extrabold text-red-200">{item.lost}점 손실</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[24px] bg-white p-6 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#2463EB]">객관 분석</p>
              <h2 className="mt-1 text-xl font-extrabold">점수 손실 구조</h2>
            </div>
            <p className="text-sm text-[#8B95A1]">오답 배점 기준 총 {lostPoints}점 손실</p>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-bold text-[#8B95A1]">다음 등급 기준</p>
              <p className="mt-2 text-2xl font-extrabold text-[#1A1C1E]">
                {gradeGap == null ? '해당 없음' : `${gradeGap}점 차이`}
              </p>
              <p className="mt-1 text-xs text-[#8B95A1]">
                {snapshot.score.grade && snapshot.score.grade > 1 ? `${snapshot.score.grade - 1}등급 기준까지` : '현재 1등급 구간'}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-bold text-[#8B95A1]">3점 문항 손실</p>
              <p className="mt-2 text-2xl font-extrabold text-[#FF4D4D]">{threePointWrong.length}문항</p>
              <p className="mt-1 text-xs text-[#8B95A1]">
                {threePointWrong.map((answer) => `${answer.mock_exam_question?.question_number}번`).join(', ') || '없음'}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-bold text-[#8B95A1]">듣기/독해 격차</p>
              <p className="mt-2 text-2xl font-extrabold text-[#2463EB]">
                {listeningAccuracy == null || readingAccuracy == null ? '-' : `${Math.abs(listeningAccuracy - readingAccuracy)}%p`}
              </p>
              <p className="mt-1 text-xs text-[#8B95A1]">
                듣기 {listeningAccuracy ?? '-'}% · 독해 {readingAccuracy ?? '-'}%
              </p>
            </div>
          </div>

        </section>

        <section className="rounded-[24px] bg-white p-6 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#2463EB]">진단 보드</p>
              <h2 className="mt-1 text-xl font-extrabold">유형별 성취</h2>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-full bg-blue-50 px-3 py-1.5 text-[#2463EB]">{typeSummary}</span>
            </div>
          </div>

          <div className="mt-5 rounded-[24px] bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-extrabold">유형별 성취 맵</h3>
                <p className="mt-1 text-xs font-medium text-[#8B95A1]">점수 손실이 큰 유형부터 배치</p>
              </div>
              {primaryFocus && (
                <span className="rounded-full bg-white px-3 py-1.5 text-xs font-extrabold text-[#FF4D4D]">
                  최우선 {primaryFocus.type}
                </span>
              )}
            </div>

            {typeRows.length === 0 ? (
              <div className="mt-4 rounded-2xl bg-white p-6 text-center text-sm font-medium text-[#8B95A1]">
                유형 분석 데이터가 없습니다.
              </div>
            ) : (
              <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {typeRows.map((item) => (
                  <div key={item.type} className={`rounded-2xl p-4 ${item.tone.tile}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-[#1A1C1E]">{item.type}</p>
                        <p className="mt-1 text-xs font-medium text-[#8B95A1]">
                          {item.correct}/{item.total} 정답 · {item.earned}/{item.points}점
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${item.tone.chip}`}>
                        {item.tone.label}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="h-2 flex-1 rounded-full bg-slate-200">
                        <div className={`h-2 rounded-full ${item.tone.bar}`} style={{ width: `${boundedPercent(item.scoreRate)}%` }} />
                      </div>
                      <span className="w-10 text-right text-xs font-extrabold text-[#1A1C1E]">{boundedPercent(item.scoreRate)}%</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs font-bold">
                      <span className="text-[#8B95A1]">손실</span>
                      <span className={item.lost > 0 ? 'text-[#FF4D4D]' : 'text-[#2463EB]'}>{item.lost}점</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {strongTypes.length > 0 && (
            <div className="mt-4 rounded-[24px] bg-blue-50 p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-[#2463EB]">유지할 강점</h3>
                  <p className="mt-1 text-xs font-medium text-[#8B95A1]">점수 손실이 적거나 성취율이 높은 유형</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {strongTypes.map((item) => (
                    <span key={item.type} className="rounded-full bg-white px-3 py-2 text-xs font-extrabold text-[#1A1C1E]">
                      {item.type} {boundedPercent(item.scoreRate)}%
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        {snapshot.teacher_comment && (
          <section className="rounded-[24px] bg-[#2463EB] p-6 text-white shadow-[0px_10px_40px_rgba(0,75,198,0.12)]">
            <h2 className="text-lg font-extrabold">교사 기록</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-blue-50">{snapshot.teacher_comment}</p>
          </section>
        )}
      </div>
    </main>
  )
}
