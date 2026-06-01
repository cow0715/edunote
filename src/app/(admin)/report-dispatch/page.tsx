'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileText, Loader2, MessageSquare, RefreshCw, Search, Send, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useMockExams } from '@/hooks/use-mock-exams'
import { cn } from '@/lib/utils'

type DispatchKind = 'monthly' | 'mock'
type RecipientKey = 'mother' | 'father' | 'student'

type DispatchStudent = {
  id: string
  name: string
  phone: string | null
  mother_phone: string | null
  father_phone: string | null
  school: string | null
  grade: string | null
}

type MonthlyItem = {
  student: DispatchStudent
  report_id: string | null
  report_status: 'missing' | 'draft' | 'published'
  report_url: string | null
  sent_count: number
  recipients: Record<RecipientKey, boolean>
}

type MockItem = {
  result_id: string
  student: DispatchStudent | null
  raw_score: number | null
  grade: number | null
  report_id: string | null
  report_status: 'missing' | 'published'
  report_url: string | null
  sent_count: number
  recipients: Record<RecipientKey, boolean>
}

type PreviewResponse = {
  kind: DispatchKind
  period?: { start: string; end: string; label: string }
  exam?: { id: string; title: string; exam_year: number; exam_month: number; grade: number | null }
  items: (MonthlyItem | MockItem)[]
}

const recipientLabels: Record<RecipientKey, string> = {
  mother: '어머니',
  father: '아버지',
  student: '학생',
}

const monthlyTemplate = '{학생명} 학생 {기간명} 성적표입니다.\n{성적표링크}'
const mockTemplate = '[{시험명}] {학생명} 학생 성적표입니다.\n{성적표링크}'

function itemId(kind: DispatchKind, item: MonthlyItem | MockItem) {
  return kind === 'monthly' ? (item as MonthlyItem).student.id : (item as MockItem).result_id
}

function itemStudent(item: MonthlyItem | MockItem) {
  return 'student' in item ? item.student : null
}

function itemReportStatus(item: MonthlyItem | MockItem) {
  return item.report_status
}

function itemSentCount(item: MonthlyItem | MockItem) {
  return item.sent_count
}

function phoneFor(student: DispatchStudent | null, recipient: RecipientKey) {
  if (!student) return null
  if (recipient === 'mother') return student.mother_phone
  if (recipient === 'father') return student.father_phone
  return student.phone
}

function currentYearMonth() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

export default function ReportDispatchPage() {
  const now = currentYearMonth()
  const [kind, setKind] = useState<DispatchKind>('monthly')
  const [year, setYear] = useState(String(now.year))
  const [month, setMonth] = useState(String(now.month))
  const [grade, setGrade] = useState('all')
  const [mockExamId, setMockExamId] = useState('')
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [recipients, setRecipients] = useState<Record<RecipientKey, boolean>>({ mother: true, father: false, student: true })
  const [includeResend, setIncludeResend] = useState(false)
  const [messageTemplate, setMessageTemplate] = useState(monthlyTemplate)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [search, setSearch] = useState('')

  const { data: mockExams = [] } = useMockExams()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('kind') === 'mock') {
      setKind('mock')
      setMessageTemplate(mockTemplate)
      setMockExamId(params.get('mockExamId') ?? '')
    }
  }, [])
  const selectedRecipients = (Object.keys(recipients) as RecipientKey[]).filter((key) => recipients[key])
  const selectedItems = useMemo(
    () => (preview?.items ?? []).filter((item) => selectedIds.has(itemId(kind, item))),
    [kind, preview?.items, selectedIds],
  )
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (preview?.items ?? []).filter((item) => {
      const student = itemStudent(item)
      if (!query) return true
      return student?.name.toLowerCase().includes(query) || student?.school?.toLowerCase().includes(query)
    })
  }, [preview?.items, search])
  const targetCount = useMemo(() => {
    return selectedItems.reduce((sum, item) => {
      const student = itemStudent(item)
      const phones = new Set(
        selectedRecipients
          .map((recipient) => phoneFor(student, recipient)?.replace(/-/g, '').trim())
          .filter(Boolean),
      )
      return sum + phones.size
    }, 0)
  }, [selectedItems, selectedRecipients])
  const missingReportCount = selectedItems.filter((item) => itemReportStatus(item) === 'missing').length
  const sentSelectedCount = selectedItems.filter((item) => itemSentCount(item) > 0).length

  function changeKind(nextKind: DispatchKind) {
    setKind(nextKind)
    setPreview(null)
    setSelectedIds(new Set())
    setMessageTemplate(nextKind === 'monthly' ? monthlyTemplate : mockTemplate)
  }

  async function loadPreview() {
    setLoading(true)
    setSelectedIds(new Set())
    try {
      const params = new URLSearchParams({ kind })
      if (kind === 'monthly') {
        params.set('year', year)
        params.set('month', month)
        params.set('grade', grade)
      } else {
        if (!mockExamId) {
          toast.error('모의고사를 선택해 주세요')
          return
        }
        params.set('mock_exam_id', mockExamId)
      }
      const res = await fetch(`/api/report-dispatch?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '대상 조회 실패')
      setPreview(data)
      const selectable = (data.items as (MonthlyItem | MockItem)[])
        .filter((item) => !itemSentCount(item) || includeResend)
        .map((item) => itemId(kind, item))
      setSelectedIds(new Set(selectable))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '대상 조회 실패')
    } finally {
      setLoading(false)
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setSelectedIds((prev) => {
      const visibleIds = filteredItems.map((item) => itemId(kind, item))
      const allSelected = visibleIds.every((id) => prev.has(id))
      const next = new Set(prev)
      for (const id of visibleIds) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  function openConfirm() {
    if (!preview) return
    if (selectedItems.length === 0) {
      toast.error('전송할 학생을 선택해 주세요')
      return
    }
    if (selectedRecipients.length === 0) {
      toast.error('수신자를 선택해 주세요')
      return
    }
    if (!messageTemplate.includes('{성적표링크}')) {
      toast.error('문자 내용에 {성적표링크}를 포함해 주세요')
      return
    }
    setConfirmOpen(true)
  }

  async function sendSelected() {
    if (!preview) return
    setSending(true)
    try {
      const body = kind === 'monthly'
        ? {
            kind,
            year: Number(year),
            month: Number(month),
            student_ids: selectedItems.map((item) => (item as MonthlyItem).student.id),
            recipients: selectedRecipients,
            message_template: messageTemplate,
            include_resend: includeResend,
          }
        : {
            kind,
            mock_exam_id: mockExamId,
            result_ids: selectedItems.map((item) => (item as MockItem).result_id),
            recipients: selectedRecipients,
            message_template: messageTemplate,
            include_resend: includeResend,
          }
      const res = await fetch('/api/report-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '성적표 전송 실패')
      toast.success(`전송 완료 ${data.sent_count}건 · 실패 ${data.failed_count}건 · 제외 ${data.skipped?.length ?? 0}건`)
      setConfirmOpen(false)
      await loadPreview()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '성적표 전송 실패')
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#EBF3FF] to-white p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-[24px] bg-white p-6 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-extrabold text-[#2463EB]">Report Dispatch</p>
              <h1 className="mt-2 text-2xl font-extrabold text-[#1A1C1E]">성적표 발송</h1>
              <p className="mt-2 text-sm font-medium text-[#8B95A1]">
                월별 성적표와 모의고사 성적표를 같은 흐름으로 검수하고 링크 문자로 일괄 전송합니다.
              </p>
            </div>
            <div className="flex rounded-full bg-slate-100 p-1">
              {[
                { value: 'monthly' as const, label: '월별 성적표' },
                { value: 'mock' as const, label: '모의고사 성적표' },
              ].map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => changeKind(tab.value)}
                  className={cn(
                    'rounded-full px-4 py-2 text-sm font-extrabold transition',
                    kind === tab.value ? 'bg-[#2463EB] text-white' : 'text-slate-500 hover:text-[#2463EB]',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
          <Card className="rounded-[24px] border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5 text-[#2463EB]" />
                발송 조건
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {kind === 'monthly' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>연도</Label>
                    <Input value={year} onChange={(event) => setYear(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>월</Label>
                    <Select value={month} onValueChange={setMonth}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((value) => (
                          <SelectItem key={value} value={value}>{value}월</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-2">
                    <Label>학년</Label>
                    <Select value={grade} onValueChange={setGrade}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">전체 학년</SelectItem>
                        <SelectItem value="1">고1</SelectItem>
                        <SelectItem value="2">고2</SelectItem>
                        <SelectItem value="3">고3</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>모의고사</Label>
                  <Select value={mockExamId} onValueChange={setMockExamId}>
                    <SelectTrigger><SelectValue placeholder="시험 선택" /></SelectTrigger>
                    <SelectContent>
                      {mockExams.map((exam) => (
                        <SelectItem key={exam.id} value={exam.id}>
                          {exam.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label>수신자</Label>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(recipientLabels) as RecipientKey[]).map((recipient) => (
                    <button
                      key={recipient}
                      type="button"
                      onClick={() => setRecipients((prev) => ({ ...prev, [recipient]: !prev[recipient] }))}
                      className={cn(
                        'rounded-full px-3 py-2 text-sm font-extrabold transition',
                        recipients[recipient] ? 'bg-[#2463EB] text-white' : 'bg-slate-100 text-slate-500 hover:bg-blue-50',
                      )}
                    >
                      {recipientLabels[recipient]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-3">
                <div>
                  <p className="text-sm font-bold text-[#1A1C1E]">재전송 포함</p>
                  <p className="text-xs font-medium text-[#8B95A1]">이미 보낸 성적표도 다시 전송</p>
                </div>
                <Switch checked={includeResend} onCheckedChange={setIncludeResend} />
              </div>

              <Button className="w-full rounded-full bg-[#2463EB]" onClick={loadPreview} disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                대상 불러오기
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card className="rounded-[24px] border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
              <CardContent className="p-5">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl bg-blue-50 p-4">
                    <p className="text-xs font-bold text-[#8B95A1]">조회 대상</p>
                    <p className="mt-1 text-2xl font-extrabold text-[#2463EB]">{preview?.items.length ?? 0}명</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-bold text-[#8B95A1]">선택</p>
                    <p className="mt-1 text-2xl font-extrabold">{selectedItems.length}명</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-bold text-[#8B95A1]">전송 건수</p>
                    <p className="mt-1 text-2xl font-extrabold">{targetCount}건</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-bold text-[#8B95A1]">생성 필요 / 전송됨</p>
                    <p className="mt-1 text-2xl font-extrabold">{missingReportCount} / {sentSelectedCount}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[24px] border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
              <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Users className="h-5 w-5 text-[#2463EB]" />
                    발송 대상 검수
                  </CardTitle>
                  <p className="mt-1 text-sm font-medium text-[#8B95A1]">
                    선택한 학생의 성적표 링크와 연락처 상태를 확인한 뒤 전송합니다.
                  </p>
                </div>
                <div className="flex gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input className="w-48 pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="학생 검색" />
                  </div>
                  <Button variant="outline" className="rounded-full" onClick={toggleAllVisible} disabled={!preview}>
                    전체 선택
                  </Button>
                  <Button className="rounded-full bg-[#2463EB]" onClick={openConfirm} disabled={!preview || selectedItems.length === 0}>
                    <Send className="mr-2 h-4 w-4" />
                    링크 문자 보내기
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {!preview ? (
                  <div className="rounded-2xl bg-slate-50 p-10 text-center">
                    <MessageSquare className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-3 text-sm font-bold text-slate-500">발송 조건을 선택하고 대상을 불러오세요.</p>
                  </div>
                ) : filteredItems.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 p-10 text-center text-sm font-bold text-slate-500">대상이 없습니다.</div>
                ) : (
                  <div className="overflow-hidden rounded-2xl bg-slate-50">
                    {filteredItems.map((item) => {
                      const student = itemStudent(item)
                      const id = itemId(kind, item)
                      const selected = selectedIds.has(id)
                      const phones = selectedRecipients
                        .map((recipient) => ({ recipient, phone: phoneFor(student, recipient) }))
                        .filter((entry) => entry.phone)
                      return (
                        <div key={id} className="grid gap-3 border-b border-white p-4 last:border-0 lg:grid-cols-[auto_1fr_auto] lg:items-center">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleSelected(id)}
                            className="mt-1 h-4 w-4 lg:mt-0"
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-extrabold text-[#1A1C1E]">{student?.name ?? '학생 정보 없음'}</span>
                              <Badge className={itemReportStatus(item) === 'missing' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-[#2463EB]'}>
                                {itemReportStatus(item) === 'missing' ? '생성 필요' : itemReportStatus(item) === 'draft' ? '임시저장' : '발급됨'}
                              </Badge>
                              {itemSentCount(item) > 0 && <Badge variant="outline">전송 {itemSentCount(item)}회</Badge>}
                              {kind === 'mock' && 'raw_score' in item && <Badge variant="outline">{item.raw_score ?? '-'}점</Badge>}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs font-medium text-[#8B95A1]">
                              <span>{student?.school ?? '학교 미입력'}</span>
                              {phones.length > 0 ? phones.map((entry) => (
                                <span key={entry.recipient}>{recipientLabels[entry.recipient]} {entry.phone}</span>
                              )) : <span className="text-[#FF4D4D]">선택한 수신자 연락처 없음</span>}
                            </div>
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            {item.report_url ? (
                              <span className="max-w-56 truncate text-xs font-bold text-[#2463EB]">{item.report_url}</span>
                            ) : (
                              <span className="text-xs font-bold text-amber-600">전송 시 자동 생성</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent className="max-w-3xl rounded-[24px] border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.08)]">
            <DialogHeader>
              <DialogTitle className="text-xl font-extrabold">발송 전 최종 확인</DialogTitle>
              <DialogDescription>
                학생별 성적표 링크가 정확한 수신자에게 가는지 확인하세요. 생성되지 않은 성적표는 전송 시 자동 생성/발급됩니다.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-2xl bg-blue-50 p-4">
                <p className="text-sm font-extrabold text-[#2463EB]">발송 요약</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl bg-white p-3">
                    <p className="text-xs text-[#8B95A1]">학생</p>
                    <p className="font-extrabold">{selectedItems.length}명</p>
                  </div>
                  <div className="rounded-xl bg-white p-3">
                    <p className="text-xs text-[#8B95A1]">문자</p>
                    <p className="font-extrabold">{targetCount}건</p>
                  </div>
                  <div className="rounded-xl bg-white p-3">
                    <p className="text-xs text-[#8B95A1]">생성 필요</p>
                    <p className="font-extrabold">{missingReportCount}명</p>
                  </div>
                  <div className="rounded-xl bg-white p-3">
                    <p className="text-xs text-[#8B95A1]">재전송</p>
                    <p className="font-extrabold">{includeResend ? '포함' : '제외'}</p>
                  </div>
                </div>
                {sentSelectedCount > 0 && !includeResend && (
                  <div className="mt-3 flex gap-2 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-700">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    이미 전송된 성적표는 기본적으로 제외됩니다.
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>문자 내용</Label>
                <Textarea
                  value={messageTemplate}
                  onChange={(event) => setMessageTemplate(event.target.value)}
                  className="min-h-40 resize-none rounded-2xl"
                />
                <p className="text-xs font-medium text-[#8B95A1]">
                  사용 가능: {'{학생명}'} {kind === 'monthly' ? '{기간명}' : '{시험명}'} {'{성적표링크}'}
                </p>
              </div>
            </div>

            <div className="max-h-56 overflow-auto rounded-2xl bg-slate-50 p-3">
              {selectedItems.slice(0, 12).map((item) => {
                const student = itemStudent(item)
                const phones = selectedRecipients
                  .map((recipient) => `${recipientLabels[recipient]} ${phoneFor(student, recipient) ?? '없음'}`)
                  .join(' · ')
                return (
                  <div key={itemId(kind, item)} className="flex items-center justify-between gap-3 border-b border-white py-2 text-sm last:border-0">
                    <span className="font-bold">{student?.name ?? '학생 정보 없음'}</span>
                    <span className="text-right text-xs font-medium text-[#8B95A1]">{phones}</span>
                  </div>
                )
              })}
              {selectedItems.length > 12 && (
                <p className="py-2 text-center text-xs font-bold text-[#8B95A1]">외 {selectedItems.length - 12}명</p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" className="rounded-full" onClick={() => setConfirmOpen(false)} disabled={sending}>
                취소
              </Button>
              <Button className="rounded-full bg-[#2463EB]" onClick={sendSelected} disabled={sending}>
                {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                확인 후 일괄 전송
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  )
}
