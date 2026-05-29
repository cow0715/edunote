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
    type_analysis: Record<string, { correct?: number; total?: number; accuracy?: number | null; score_rate?: number | null }>
  }
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

        {snapshot.teacher_comment && (
          <section className="rounded-[24px] bg-[#2463EB] p-6 text-white shadow-[0px_10px_40px_rgba(0,75,198,0.12)]">
            <h2 className="text-lg font-extrabold">선생님 코멘트</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-blue-50">{snapshot.teacher_comment}</p>
          </section>
        )}
      </div>
    </main>
  )
}
