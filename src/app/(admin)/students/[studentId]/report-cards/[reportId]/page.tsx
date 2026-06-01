'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Printer, Save, CheckCircle2, Sparkles, Plus, X, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useReportCard, useUpdateReportCard } from '@/hooks/use-report-cards'
import { suggestGrade, buildAutoSummary } from '@/lib/report-card'
import { ReportCardPreview, buildInsightLines } from '@/components/report-cards/report-card-preview'
import { toast } from 'sonner'

const defaultReportCardMessage = '{학생명} 학생 {기간명} 성적표입니다.\n{성적표링크}'

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
  const [insights, setInsights] = useState<{ color: string; text: string }[] | null>(null)
  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const [sendPhone, setSendPhone] = useState('')
  const [sendMessage, setSendMessage] = useState(defaultReportCardMessage)
  const [sendPreviewUrl, setSendPreviewUrl] = useState('')

  // next_focus string derived from goalItems
  const nextFocus = goalItems.filter(Boolean).join('\n')

  useEffect(() => {
    if (!data) return
    setGrade(data.card.overall_grade ?? '')
    setComment(data.card.teacher_comment ?? '')
    setSummary(data.card.summary_text ?? '')
    const loaded = (data.card.next_focus ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
    setGoalItems(loaded.length > 0 ? [...loaded, ''] : [''])
    const autoInsights = buildInsightLines(
      data.metrics.avgReading, data.metrics.avgWriting, data.metrics.avgVocab, data.metrics.avgHomework,
      data.metrics.overallAvg, data.previous, data.classContext, data.metrics.achievements,
    )
    setInsights(autoInsights)
    setDirty(false)
  }, [data])

  if (isLoading) return <div className="p-6 text-sm text-gray-500">불러오는 중...</div>
  if (error || !data) return <div className="p-6 text-sm text-red-500">성적표를 불러올 수 없습니다</div>

  const { card, student, metrics, previous, academy, classContext } = data
  const suggestedGrade = suggestGrade(metrics.overallAvg)
  const reportUrl = typeof window === 'undefined'
    ? `/report-cards/${card.share_token}`
    : `${window.location.origin}/report-cards/${card.share_token}`
  const renderedSendMessage = sendMessage
    .replaceAll('{학생명}', student.name)
    .replaceAll('{기간명}', card.period_label)
    .replaceAll('{성적표링크}', sendPreviewUrl || reportUrl)

  function markDirty() { setDirty(true) }

  async function saveCurrentCard(status?: 'published') {
    const savedCard = await update.mutateAsync({
      id: reportId,
      overall_grade: grade || null,
      teacher_comment: comment || null,
      next_focus: nextFocus || null,
      summary_text: summary || null,
      ...(status ? { status } : {}),
    })
    setDirty(false)
    return savedCard
  }

  async function handleSave() {
    await saveCurrentCard()
    toast.success('저장되었습니다')
  }

  async function handlePublish() {
    await saveCurrentCard('published')
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

  function openSendDialog() {
    setSendPreviewUrl(reportUrl)
    setSendDialogOpen(true)
  }

  async function handleConfirmSendLink() {
    const phone = sendPhone.replace(/-/g, '').trim()
    if (!phone) {
      toast.error('전송할 전화번호를 입력해 주세요')
      return
    }
    if (!sendMessage.includes('{성적표링크}')) {
      toast.error('문자 내용에 {성적표링크}를 포함해 주세요')
      return
    }

    if (dirty || card.status !== 'published') {
      const confirmed = window.confirm('현재 성적표를 저장하고 발급 완료 상태로 바꾼 뒤 링크를 전송합니다. 계속할까요?')
      if (!confirmed) return
      await saveCurrentCard('published')
    }

    setSending(true)
    try {
      toast.info('성적표 링크 전송 중...')
      const res = await fetch(`/api/report-cards/${reportId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          recipient_label: '테스트',
          message_template: sendMessage,
        }),
      })

      const result = await res.json()
      if (!res.ok || result.success === false) {
        toast.error(`발송 실패: ${result.error ?? '알 수 없는 오류'}`)
      } else {
        toast.success(`${phone}로 링크 전송 완료`)
        setSendDialogOpen(false)
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
          <Button variant="outline" size="sm" onClick={openSendDialog} disabled={sending}>
            <Send className="mr-1.5 h-4 w-4" />
            {sending ? '발송 중...' : '링크 문자 테스트'}
          </Button>
        </div>
      </div>

      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent className="max-w-xl rounded-[24px] border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.08)]">
          <DialogHeader>
            <DialogTitle className="text-xl font-extrabold text-[#1A1C1E]">성적표 링크 전송 확인</DialogTitle>
            <DialogDescription>
              학생 성적 링크가 다른 사람에게 전송되지 않도록 수신자와 링크를 확인한 뒤 발송하세요.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 rounded-2xl bg-blue-50 p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold text-[#8B95A1]">학생</span>
                <span className="font-extrabold text-[#1A1C1E]">{student.name}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold text-[#8B95A1]">성적표</span>
                <span className="text-right font-extrabold text-[#1A1C1E]">{card.period_label}</span>
              </div>
              <div className="grid gap-1">
                <span className="font-bold text-[#8B95A1]">전송 링크</span>
                <div className="break-all rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#2463EB]">
                  {sendPreviewUrl || reportUrl}
                </div>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="report-card-send-phone">받는 전화번호</Label>
              <Input
                id="report-card-send-phone"
                value={sendPhone}
                onChange={(event) => setSendPhone(event.target.value)}
                placeholder="010-1234-5678"
                className="rounded-2xl"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="report-card-send-message">문자 내용</Label>
              <Textarea
                id="report-card-send-message"
                value={sendMessage}
                onChange={(event) => setSendMessage(event.target.value)}
                className="min-h-24 resize-none rounded-2xl"
              />
              <p className="text-xs font-medium text-[#8B95A1]">
                사용 가능: {'{학생명}'} {'{기간명}'} {'{성적표링크}'}
              </p>
            </div>

            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-bold text-[#8B95A1]">발송 미리보기</p>
              <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-6 text-[#1A1C1E]">{renderedSendMessage}</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" className="rounded-full" onClick={() => setSendDialogOpen(false)} disabled={sending}>
              취소
            </Button>
            <Button className="rounded-full bg-[#2463EB]" onClick={handleConfirmSendLink} disabled={sending || !sendPhone.trim()}>
              <Send className="mr-2 h-4 w-4" />
              {sending ? '전송 중...' : '확인 후 전송'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            editableInsights={insights}
            onInsightChange={(i, text) => {
              setInsights(prev => prev ? prev.map((line, idx) => idx === i ? { ...line, text } : line) : prev)
              setDirty(true)
            }}
            onInsightDelete={(i) => {
              setInsights(prev => prev ? prev.filter((_, idx) => idx !== i) : prev)
              setDirty(true)
            }}
            onInsightAdd={() => {
              setInsights(prev => [...(prev ?? []), { color: '#2463EB', text: '' }])
              setDirty(true)
            }}
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
