'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Printer, Save, CheckCircle2, Sparkles, Plus, X, Send } from 'lucide-react'
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
  const [summary, setSummary] = useState('')
  const [goalItems, setGoalItems] = useState<string[]>([''])
  const [dirty, setDirty] = useState(false)
  const [sending, setSending] = useState(false)

  // next_focus string derived from goalItems
  const nextFocus = goalItems.filter(Boolean).join('\n')

  useEffect(() => {
    if (!data) return
    setGrade(data.card.overall_grade ?? '')
    setComment(data.card.teacher_comment ?? '')
    setSummary(data.card.summary_text ?? '')
    const loaded = (data.card.next_focus ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
    setGoalItems(loaded.length > 0 ? [...loaded, ''] : [''])
    setDirty(false)
  }, [data])

  if (isLoading) return <div className="p-6 text-sm text-gray-500">불러오는 중...</div>
  if (error || !data) return <div className="p-6 text-sm text-red-500">성적표를 불러올 수 없습니다</div>

  const { card, student, metrics, previous, academy, classContext } = data
  const suggestedGrade = suggestGrade(metrics.overallAvg)

  function markDirty() { setDirty(true) }

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

  function handleAutoSummary() {
    const auto = buildAutoSummary(student.name, metrics, previous, classContext)
    setSummary(auto)
    setDirty(true)
  }

  function updateGoalItem(index: number, value: string) {
    const next = [...goalItems]
    next[index] = value
    setGoalItems(next)
    setDirty(true)
  }

  function removeGoalItem(index: number) {
    const next = goalItems.filter((_, i) => i !== index)
    setGoalItems(next.length > 0 ? next : [''])
    setDirty(true)
  }

  function addGoalItem() {
    setGoalItems([...goalItems, ''])
  }

  async function handleSendMms() {
    const phone = window.prompt('테스트로 받을 전화번호를 입력하세요 (예: 010-1234-5678)')
    if (!phone) return

    const node = document.querySelector<HTMLElement>('.print-area')
    if (!node) {
      toast.error('성적표 영역을 찾을 수 없습니다')
      return
    }

    setSending(true)
    try {
      const html2canvas = (await import('html2canvas-pro')).default

      const rect = node.getBoundingClientRect()
      const MAX_W = 1500
      const MAX_H = 1440
      const scale = Math.min(1.5, MAX_W / rect.width, MAX_H / rect.height)

      const canvas = await html2canvas(node, {
        backgroundColor: '#ffffff',
        scale,
        useCORS: true,
      })

      let dataUrl = canvas.toDataURL('image/jpeg', 0.85)
      let sizeKB = Math.round((dataUrl.length * 3) / 4 / 1024)

      let quality = 0.85
      while (sizeKB > 195 && quality > 0.4) {
        quality -= 0.1
        dataUrl = canvas.toDataURL('image/jpeg', quality)
        sizeKB = Math.round((dataUrl.length * 3) / 4 / 1024)
      }

      if (sizeKB > 195) {
        toast.error(`이미지가 너무 큽니다 (${sizeKB}KB). MMS 200KB 제한 초과`)
        return
      }

      toast.info(`이미지 ${sizeKB}KB 발송 중...`)

      const res = await fetch('/api/sms/send-report-mms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: student.id,
          phone,
          recipientLabel: '테스트',
          image: dataUrl,
          subject: `${student.name} ${card.period_label} 성적표`,
          text: `${student.name} 학생 ${card.period_label} 성적표입니다.`,
        }),
      })

      const result = await res.json()
      if (!res.ok || result.success === false) {
        toast.error(`발송 실패: ${result.error ?? '알 수 없는 오류'}`)
      } else {
        toast.success(`${phone}로 발송 완료`)
      }
    } catch (e) {
      toast.error(`오류: ${e instanceof Error ? e.message : '알 수 없는 오류'}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="report-card-root">
      {/* 상단 툴바 */}
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
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" />
            PDF / 인쇄
          </Button>
          <Button variant="outline" size="sm" onClick={handleSendMms} disabled={sending}>
            <Send className="mr-1.5 h-4 w-4" />
            {sending ? '발송 중...' : '문자 테스트'}
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

          {/* ── 종합 등급 ── */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">종합 등급</h3>
            <div className="flex items-center gap-2">
              <Input
                value={grade}
                onChange={(e) => { setGrade(e.target.value); markDirty() }}
                placeholder="A / B / C / D"
                maxLength={4}
                className="w-24 text-center text-lg font-bold"
              />
              {!grade && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-primary"
                  onClick={() => { setGrade(suggestedGrade); markDirty() }}
                >
                  추천: {suggestedGrade}
                </Button>
              )}
            </div>
            <p className="text-xs text-gray-400">
              평균 {metrics.overallAvg ?? '-'}% 기준 자동 추천: <span className="font-semibold">{suggestedGrade}</span>
            </p>
          </div>

          {/* ── 선생님 메시지 (요약 + 코멘트 통합) ── */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">선생님 메시지</h3>
              <Button type="button" variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={handleAutoSummary}>
                <Sparkles className="h-3.5 w-3.5" />
                자동 생성
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-gray-500">핵심 요약 <span className="text-gray-400 font-normal">(학부모용 · 자동 생성 후 다듬기)</span></Label>
              <Textarea
                value={summary}
                onChange={(e) => { setSummary(e.target.value); markDirty() }}
                rows={4}
                placeholder="자동 생성 버튼을 눌러 초안을 만들어보세요"
                className="text-sm resize-none"
              />
              {previous && (
                <p className="text-xs text-gray-400">
                  {previous.label} {previous.overallAvg ?? '-'}% → 이번 {metrics.overallAvg ?? '-'}%
                </p>
              )}
            </div>

            <div className="border-t border-gray-100 pt-4 space-y-1.5">
              <Label className="text-xs text-gray-500">상세 코멘트 <span className="text-gray-400 font-normal">(선택)</span></Label>
              <Textarea
                value={comment}
                onChange={(e) => { setComment(e.target.value); markDirty() }}
                rows={4}
                placeholder="수업 태도, 특이사항, 격려 메시지 등을 자유롭게 작성하세요"
                className="text-sm resize-none"
              />
            </div>
          </div>

          {/* ── 다음 기간 목표 — 개별 입력 ── */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">다음 달 목표</h3>
              <span className="text-[10px] text-gray-400">{goalItems.filter(Boolean).length}개 설정됨</span>
            </div>

            <div className="space-y-2">
              {goalItems.map((item, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-300 w-4 text-right shrink-0">{i + 1}</span>
                  <Input
                    value={item}
                    onChange={(e) => updateGoalItem(i, e.target.value)}
                    placeholder={
                      i === 0 ? '목표 점수 (예: 독해 90점 이상)' :
                      i === 1 ? '집중 영역 (예: 어휘 추론 훈련)' :
                      i === 2 ? '추가 과제 (예: 주 3회 단어 암기)' :
                      `목표 ${i + 1}`
                    }
                    className="text-sm h-8"
                  />
                  {goalItems.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-gray-300 hover:text-gray-500 shrink-0"
                      onClick={() => removeGoalItem(i)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {goalItems.length < 6 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full text-xs text-gray-400 border border-dashed border-gray-200 h-8"
                onClick={addGoalItem}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                항목 추가
              </Button>
            )}
            <p className="text-xs text-gray-400">입력한 항목이 성적표에 목표로 표시됩니다</p>
          </div>

        </aside>
      </div>

      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          html, body { background: white !important; }
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>
    </div>
  )
}
