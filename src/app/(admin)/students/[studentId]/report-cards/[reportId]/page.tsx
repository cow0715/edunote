'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Printer, Save, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useReportCard, useUpdateReportCard } from '@/hooks/use-report-cards'
import { suggestGrade } from '@/lib/report-card'
import { ReportCardPreview } from '@/components/report-cards/report-card-preview'
import { toast } from 'sonner'

export default function ReportCardDetailPage({ params }: { params: Promise<{ studentId: string; reportId: string }> }) {
  const { studentId, reportId } = use(params)
  const router = useRouter()
  const { data, isLoading, error } = useReportCard(reportId)
  const update = useUpdateReportCard()

  const [grade, setGrade] = useState('')
  const [comment, setComment] = useState('')
  const [nextFocus, setNextFocus] = useState('')
  const [highlighted, setHighlighted] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!data) return
    setGrade(data.card.overall_grade ?? '')
    setComment(data.card.teacher_comment ?? '')
    setNextFocus(data.card.next_focus ?? '')
    setHighlighted(data.card.highlighted_wrong_ids ?? [])
    setDirty(false)
  }, [data])

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-500">불러오는 중...</div>
  }
  if (error || !data) {
    return <div className="p-6 text-sm text-red-500">성적표를 불러올 수 없습니다</div>
  }

  const { card, student, metrics } = data
  const suggestedGrade = suggestGrade(metrics.overallAvg)

  function toggleHighlight(answerId: string) {
    setHighlighted((prev) =>
      prev.includes(answerId) ? prev.filter((id) => id !== answerId) : [...prev, answerId]
    )
    setDirty(true)
  }

  async function handleSave() {
    await update.mutateAsync({
      id: reportId,
      overall_grade: grade || null,
      teacher_comment: comment || null,
      next_focus: nextFocus || null,
      highlighted_wrong_ids: highlighted,
    })
    setDirty(false)
    toast.success('저장되었습니다')
  }

  async function handlePublish() {
    await update.mutateAsync({
      id: reportId,
      overall_grade: grade || null,
      teacher_comment: comment || null,
      next_focus: nextFocus || null,
      highlighted_wrong_ids: highlighted,
      status: 'published',
    })
    setDirty(false)
    toast.success('성적표가 발급되었습니다')
  }

  function handlePrint() {
    window.print()
  }

  const selectedWrongs = metrics.wrongItems.filter((w) => highlighted.includes(w.answer_id))

  return (
    <div className="report-card-root">
      {/* 상단 바 — 인쇄 시 숨김 */}
      <div className="print:hidden sticky top-0 z-10 -mx-4 -mt-4 md:-mx-6 md:-mt-6 mb-4 border-b bg-white px-4 md:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => router.push('/students')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-gray-900 truncate">
                {student.name} · {card.period_label}
              </h1>
              {card.status === 'published' ? (
                <Badge variant="secondary" className="bg-blue-50 text-blue-600 border-blue-200">발급 완료</Badge>
              ) : (
                <Badge variant="secondary" className="bg-gray-100 text-gray-500">임시저장</Badge>
              )}
            </div>
            <p className="text-xs text-gray-400">{card.period_start} ~ {card.period_end}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSave} disabled={update.isPending || !dirty}>
            <Save className="mr-1.5 h-4 w-4" />
            저장
          </Button>
          {card.status !== 'published' && (
            <Button size="sm" onClick={handlePublish} disabled={update.isPending}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              발급 확정
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="mr-1.5 h-4 w-4" />
            PDF 저장 / 인쇄
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px] print:block">
        {/* 성적표 미리보기 (인쇄 대상) */}
        <div className="print-area">
          <ReportCardPreview
            student={student}
            card={{ ...card, overall_grade: grade || null, teacher_comment: comment || null, next_focus: nextFocus || null }}
            metrics={metrics}
            highlightedWrongs={selectedWrongs}
          />
        </div>

        {/* 편집 사이드 패널 — 인쇄 시 숨김 */}
        <aside className="print:hidden space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">종합 평가</h3>
            <div className="space-y-2">
              <Label htmlFor="grade" className="text-xs">등급</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="grade"
                  value={grade}
                  onChange={(e) => { setGrade(e.target.value); setDirty(true) }}
                  placeholder="A / B / C / D"
                  maxLength={4}
                  className="w-28"
                />
                {!grade && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs text-primary"
                    onClick={() => { setGrade(suggestedGrade); setDirty(true) }}
                  >
                    추천: {suggestedGrade}
                  </Button>
                )}
              </div>
              <p className="text-xs text-gray-400">
                평균 정답률 {metrics.overallAvg ?? '-'}% 기준 자동 추천: {suggestedGrade}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">선생님 코멘트</h3>
            <Textarea
              value={comment}
              onChange={(e) => { setComment(e.target.value); setDirty(true) }}
              rows={5}
              placeholder="기간 전반에 대한 종합 의견을 작성하세요"
            />
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">다음 기간 학습 권장</h3>
            <Textarea
              value={nextFocus}
              onChange={(e) => { setNextFocus(e.target.value); setDirty(true) }}
              rows={4}
              placeholder="다음 달 집중할 영역이나 학습 방향"
            />
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">
              핵심 오답 선별 ({highlighted.length}개)
            </h3>
            <p className="text-xs text-gray-400">
              성적표에 실을 오답을 선택하세요 (3~5개 권장)
            </p>
            {metrics.wrongItems.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">
                이 기간에 오답이 없습니다
              </p>
            ) : (
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {metrics.wrongItems.map((w) => {
                  const on = highlighted.includes(w.answer_id)
                  return (
                    <button
                      key={w.answer_id}
                      type="button"
                      onClick={() => toggleHighlight(w.answer_id)}
                      className={`w-full text-left rounded-md border px-2.5 py-2 text-xs transition ${
                        on
                          ? 'border-primary bg-primary/5'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-gray-900">
                          {w.week_number}주 · {w.exam_type === 'vocab' ? '단어' : '독해'} {w.question_number}{w.sub_label ?? ''}번
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {w.my_answer} → {w.correct_answer}
                        </span>
                      </div>
                      {w.tags.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {w.tags.slice(0, 3).map((t, i) => (
                            <span key={i} className="text-[10px] text-gray-500">#{t}</span>
                          ))}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </aside>
      </div>

      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 12mm 12mm 12mm 12mm;
          }
          html, body {
            background: white !important;
          }
          body * {
            visibility: hidden;
          }
          .print-area, .print-area * {
            visibility: visible;
          }
          .print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
        }
      `}</style>
    </div>
  )
}
