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
  const cohort = snapshot.cohort ?? null
  const weakTypes = typeEntries
    .map(([type, value]) => ({
      type,
      correct: Number(value.correct ?? 0),
      total: Number(value.total ?? 0),
      earned: Number(value.earned ?? 0),
      points: Number(value.points ?? 0),
      accuracy: value.accuracy,
      scoreRate: value.score_rate,
      lost: Math.max(0, Number(value.points ?? 0) - Number(value.earned ?? 0)),
    }))
    .filter((item) => item.total > 0 && item.lost > 0)
    .sort((a, b) => b.lost - a.lost || Number(a.scoreRate ?? 100) - Number(b.scoreRate ?? 100))
  const priorityTypes = weakTypes.slice(0, 3)
  const highImpactWrong = wrongAnswers
    .slice()
    .sort((a, b) => Number(b.mock_exam_question?.points ?? 0) - Number(a.mock_exam_question?.points ?? 0))
    .slice(0, 5)

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#EBF3FF] to-white px-4 py-8 text-[#1A1C1E]">
      <div className="mx-auto max-w-4xl space-y-5">
        <section className="rounded-[24px] bg-white p-6 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#2463EB]">EduNote 모의고사 성적표</p>
              <h1 className="mt-2 text-2xl font-extrabold md:text-3xl">{snapshot.exam.title}</h1>
              <p className="mt-2 text-sm text-[#8B95A1]">
                {snapshot.exam.exam_year}년 {snapshot.exam.exam_month}월 · {snapshot.exam.source}
                {snapshot.exam.exam_date ? ` · ${snapshot.exam.exam_date}` : ''}
              </p>
            </div>
            <div className="rounded-2xl bg-blue-50 px-5 py-4 text-right">
              <p className="text-sm text-[#8B95A1]">{snapshot.student.name}</p>
              <p className="mt-1 text-4xl font-extrabold text-[#2463EB]">{snapshot.score.raw_score ?? '-'}점</p>
              <p className="mt-1 text-sm font-bold text-[#1A1C1E]">{snapshot.score.grade ?? '-'}등급</p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-[24px] bg-white p-5 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
            <p className="text-sm text-[#8B95A1]">석차</p>
            <p className="mt-2 text-2xl font-extrabold text-[#2463EB]">
              {cohort?.rank && cohort.total ? `${cohort.rank}/${cohort.total}` : '-'}
            </p>
            <p className="mt-1 text-xs text-[#8B95A1]">
              {cohort?.average_score != null ? `평균 ${cohort.average_score}점 · 최고 ${cohort.top_score}점` : '발행 시점 응시자 기준'}
            </p>
          </div>
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
              <p className="text-xs font-bold text-[#8B95A1]">응시자 내 위치</p>
              <p className="mt-2 text-2xl font-extrabold text-[#1A1C1E]">
                {cohort?.rank && cohort.total ? `${cohort.rank}등 / ${cohort.total}명` : '산출 전'}
              </p>
              <p className="mt-1 text-xs text-[#8B95A1]">
                {cohort?.same_score_count && cohort.same_score_count > 1 ? `동점자 ${cohort.same_score_count}명` : '동점자는 동일 석차'}
              </p>
            </div>
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
            <div className="rounded-2xl bg-slate-50 p-4 md:col-span-3">
              <p className="text-xs font-bold text-[#8B95A1]">듣기/독해 격차</p>
              <p className="mt-2 text-2xl font-extrabold text-[#2463EB]">
                {listeningAccuracy == null || readingAccuracy == null ? '-' : `${Math.abs(listeningAccuracy - readingAccuracy)}%p`}
              </p>
              <p className="mt-1 text-xs text-[#8B95A1]">
                듣기 {listeningAccuracy ?? '-'}% · 독해 {readingAccuracy ?? '-'}%
              </p>
            </div>
          </div>

          {priorityTypes.length > 0 && (
            <div className="mt-5 rounded-2xl bg-blue-50 p-4">
              <h3 className="text-sm font-extrabold text-[#2463EB]">수업 우선순위</h3>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {priorityTypes.map((item) => (
                  <div key={item.type} className="rounded-2xl bg-white p-4">
                    <p className="font-extrabold">{item.type}</p>
                    <p className="mt-1 text-sm text-[#8B95A1]">
                      {item.correct}/{item.total} 정답 · {item.lost}점 손실
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-[24px] bg-white p-6 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
          <h2 className="text-lg font-extrabold">유형별 성취</h2>
          <div className="mt-4 space-y-3">
            {typeEntries.map(([type, value]) => (
              <div key={type}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-semibold">{type}</span>
                  <span className="text-[#8B95A1]">{value.correct ?? 0}/{value.total ?? 0} · {value.accuracy ?? '-'}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-[#2463EB]" style={{ width: `${value.accuracy ?? 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[24px] bg-white p-6 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
          <h2 className="text-lg font-extrabold">오답 문항</h2>
          {snapshot.wrong_answers.length === 0 ? (
            <p className="mt-4 rounded-2xl bg-blue-50 p-4 text-sm text-[#2463EB]">오답 문항이 없습니다.</p>
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {snapshot.wrong_answers.map((answer) => (
                <div key={answer.mock_exam_question?.question_number} className="rounded-2xl bg-slate-50 p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">{answer.mock_exam_question?.question_number}번</span>
                    <span className="text-[#8B95A1]">{answer.mock_exam_question?.question_type} · {answer.mock_exam_question?.points}점</span>
                  </div>
                  <p className="mt-2 text-[#8B95A1]">
                    제출 답안 {answer.student_answer || '미응답'} · 정답 {answer.mock_exam_question?.correct_answer}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {highImpactWrong.length > 0 && (
          <section className="rounded-[24px] bg-white p-6 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
            <h2 className="text-lg font-extrabold">우선 복습 문항</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {highImpactWrong.map((answer) => (
                <div key={answer.mock_exam_question?.question_number} className="rounded-2xl bg-slate-50 p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">{answer.mock_exam_question?.question_number}번</span>
                    <span className="text-[#FF4D4D]">{answer.mock_exam_question?.points}점 손실</span>
                  </div>
                  <p className="mt-2 text-[#8B95A1]">
                    {answer.mock_exam_question?.question_type} · {answer.mock_exam_question?.difficulty}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

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
