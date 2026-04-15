'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Printer, Save, CheckCircle2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useReportCard, useUpdateReportCard } from '@/hooks/use-report-cards'
import { suggestGrade, buildAutoSummary } from '@/lib/report-card'
import { ReportCardPreview } from '@/components/report-cards/report-card-preview'
import { toast } from 'sonner'

export default function ReportCardDetailPage({ params }: { params: Promise<{ studentId: string; reportId: string }> }) {
  const { reportId } = use(params)
  const router = useRouter()
  const { data, isLoading, error } = useReportCard(reportId)
  const update = useUpdateReportCard()

  const [grade, setGrade] = useState('')
  const [comment, setComment] = useState('')
  const [nextFocus, setNextFocus] = useState('')
  const [summary, setSummary] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!data) return
    setGrade(data.card.overall_grade ?? '')
    setComment(data.card.teacher_comment ?? '')
    setNextFocus(data.card.next_focus ?? '')
    setSummary(data.card.summary_text ?? '')
    setDirty(false)
  }, [data])

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-500">불러오는 중...</div>
  }
  if (error || !data) {
    return <div className="p-6 text-sm text-red-500">성적표를 불러올 수 없습니다</div>
  }

  const { card, student, metrics, previous, academy, classContext } = data
  const suggestedGrade = suggestGrade(metrics.overallAvg)

  async function handleSave() {
    await update.mutateAsync({
      id: reportId,
      overall_grade: grade || null,
      teacher_comment: comment || null,
      next_focus: nextFocus || null,
      summary_text: summary || null,
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
      summary_text: summary || null,
      status: 'published',
    })
    setDirty(false)
    toast.success('성적표가 발급되었습니다')
  }

  function handlePrint() {
    window.print()
  }

  function handleAutoSummary() {
    const auto = buildAutoSummary(student.name, metrics, previous)
    setSummary(auto)
    setDirty(true)
  }

  return (
    <div className="report-card-root">
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
        <div className="print-area">
          <ReportCardPreview
            student={student}
            card={{
              ...card,
              overall_grade: grade || null,
              teacher_comment: comment || null,
              next_focus: nextFocus || null,
              summary_text: summary || null,
            }}
            metrics={metrics}
            previous={previous}
            academy={academy}
            classContext={classContext}
          />
        </div>

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
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">한 줄 요약</h3>
              <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={handleAutoSummary}>
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                자동 생성
              </Button>
            </div>
            <Textarea
              value={summary}
              onChange={(e) => { setSummary(e.target.value); setDirty(true) }}
              rows={3}
              placeholder="자동 생성 후 학부모 언어로 다듬어주세요"
            />
            {previous && (
              <p className="text-xs text-gray-400">
                전 기간({previous.label}) 평균 {previous.overallAvg ?? '-'}% → 이번 {metrics.overallAvg ?? '-'}%
              </p>
            )}
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
            <h3 className="text-sm font-semibold text-gray-900">다음 기간 학습 목표</h3>
            <Textarea
              value={nextFocus}
              onChange={(e) => { setNextFocus(e.target.value); setDirty(true) }}
              rows={5}
              placeholder="한 줄에 한 개씩 (체크리스트로 표시됩니다)&#10;예: 어휘 추론 주 3회 훈련&#10;긴 지문 읽기 속도 개선"
            />
            <p className="text-xs text-gray-400">엔터로 구분한 각 줄이 체크박스 항목이 됩니다</p>
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
