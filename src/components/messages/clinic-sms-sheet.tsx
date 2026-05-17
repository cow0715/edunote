'use client'

import React, { useMemo, useState } from 'react'
import { CalendarCheck, Check, Copy, Loader2, RefreshCw, Send, X, XCircle } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'

type RecipientKey = 'mother' | 'father' | 'student'
type SendStatus = 'idle' | 'sending' | 'success' | 'error'

type ClinicSmsMessage = {
  student_id: string
  student_name: string
  phone: string | null
  father_phone: string | null
  mother_phone: string | null
  message: string
}

type ClinicSmsResponse = {
  date: string
  slot: { id: string; starts_at: string; ends_at: string } | null
  slot_label: string | null
  messages: ClinicSmsMessage[]
}

const RECIPIENT_LABEL: Record<RecipientKey, string> = {
  mother: '어머니',
  father: '아버지',
  student: '학생',
}

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2).toString().padStart(2, '0')
  const m = i % 2 === 0 ? '00' : '30'
  return `${h}:${m}`
})

function getToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getRelativeDateLabel(date: string) {
  const today = getToday()
  const tomorrow = new Date(`${today}T00:00:00`)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`

  if (date === today) return '오늘'
  if (date === tomorrowStr) return '내일'
  return formatDateLabel(date)
}

function getNearestSchedule() {
  const now = new Date()
  const nearest = new Date(Math.ceil(now.getTime() / (30 * 60 * 1000)) * (30 * 60 * 1000))
  const yyyy = nearest.getFullYear()
  const mm = String(nearest.getMonth() + 1).padStart(2, '0')
  const dd = String(nearest.getDate()).padStart(2, '0')
  const hh = String(nearest.getHours()).padStart(2, '0')
  const min = String(nearest.getMinutes()).padStart(2, '0')
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` }
}

function formatDateLabel(date: string) {
  const d = new Date(`${date}T00:00:00`)
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
}

export function ClinicSmsSheet({ children, date: targetDate }: { children?: React.ReactNode; date?: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const date = targetDate ?? getToday()
  const relativeDateLabel = getRelativeDateLabel(date)
  const [slotLabel, setSlotLabel] = useState<string | null>(null)
  const [messages, setMessages] = useState<ClinicSmsMessage[]>([])
  const [templateMessage, setTemplateMessage] = useState('')
  const [selectedRecipients, setSelectedRecipients] = useState<Record<string, Set<RecipientKey>>>({})
  const [sendStatus, setSendStatus] = useState<Record<string, SendStatus>>({})
  const [sendError, setSendError] = useState<Record<string, string>>({})
  const [sendingAll, setSendingAll] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleDate, setScheduleDate] = useState(() => getNearestSchedule().date)
  const [scheduleTime, setScheduleTime] = useState(() => getNearestSchedule().time)
  const qc = useQueryClient()

  const hasSendableMessage = messages.some((m) => m.message.trim() && sendStatus[m.student_id] !== 'success')

  async function loadMessages() {
    setLoading(true)
    try {
      const res = await fetch(`/api/clinic/sms?date=${encodeURIComponent(date)}`)
      if (!res.ok) throw new Error((await res.json()).error ?? '클리닉 문자 대상을 불러오지 못했습니다')
      const data = await res.json() as ClinicSmsResponse
      setSlotLabel(data.slot_label)
      setMessages(data.messages)

      const defaults: Record<string, Set<RecipientKey>> = {}
      for (const m of data.messages) {
        const keys = new Set<RecipientKey>()
        if (m.mother_phone) keys.add('mother')
        if (m.phone) keys.add('student')
        if (keys.size === 0 && m.father_phone) keys.add('father')
        defaults[m.student_id] = keys
      }
      setSelectedRecipients(defaults)
      setSendStatus({})
      setSendError({})
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '클리닉 문자 대상을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }

  function handleOpen(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) void loadMessages()
    if (!nextOpen) {
      setSendStatus({})
      setSendError({})
      setScheduleEnabled(false)
      const ns = getNearestSchedule()
      setScheduleDate(ns.date)
      setScheduleTime(ns.time)
    }
  }

  function buildScheduledDate() {
    if (!scheduleEnabled || !scheduleDate || !scheduleTime) return undefined
    return `${scheduleDate}T${scheduleTime}:00+09:00`
  }

  const isSchedulePast = useMemo(() => {
    if (!scheduleEnabled || !scheduleDate || !scheduleTime) return false
    return new Date(`${scheduleDate}T${scheduleTime}:00+09:00`).getTime() <= Date.now()
  }, [scheduleEnabled, scheduleDate, scheduleTime])

  const typeStats = useMemo(() => {
    const stats: Record<RecipientKey, { total: number; selected: number }> = {
      mother: { total: 0, selected: 0 },
      father: { total: 0, selected: 0 },
      student: { total: 0, selected: 0 },
    }

    for (const m of messages) {
      const phoneMap: Record<RecipientKey, string | null> = {
        mother: m.mother_phone,
        father: m.father_phone,
        student: m.phone,
      }
      for (const key of Object.keys(phoneMap) as RecipientKey[]) {
        if (!phoneMap[key]) continue
        stats[key].total++
        if (selectedRecipients[m.student_id]?.has(key)) stats[key].selected++
      }
    }

    return stats
  }, [messages, selectedRecipients])

  function typeCheckState(key: RecipientKey): boolean | 'indeterminate' {
    const { total, selected } = typeStats[key]
    if (total === 0 || selected === 0) return false
    if (selected === total) return true
    return 'indeterminate'
  }

  function toggleType(key: RecipientKey) {
    const allChecked = typeStats[key].selected === typeStats[key].total
    setSelectedRecipients((prev) => {
      const next = { ...prev }
      for (const m of messages) {
        const phone = key === 'mother' ? m.mother_phone : key === 'father' ? m.father_phone : m.phone
        if (!phone) continue
        const selected = new Set(next[m.student_id] ?? [])
        if (allChecked) selected.delete(key)
        else selected.add(key)
        next[m.student_id] = selected
      }
      return next
    })
  }

  function toggleRecipient(studentId: string, key: RecipientKey) {
    setSelectedRecipients((prev) => {
      const next = { ...prev }
      const selected = new Set(next[studentId] ?? [])
      if (selected.has(key)) selected.delete(key)
      else selected.add(key)
      next[studentId] = selected
      return next
    })
  }

  function updateMessage(studentId: string, text: string) {
    setMessages((prev) => prev.map((m) => m.student_id === studentId ? { ...m, message: text } : m))
  }

  function applyTemplateToAll() {
    const text = templateMessage.trim()
    if (!text) {
      toast.error('공통 문자 내용을 입력해주세요')
      return
    }
    const hasEditedMessages = messages.some((m) => m.message.trim() && sendStatus[m.student_id] !== 'success')
    if (hasEditedMessages && !window.confirm('작성된 학생별 문자를 공통 내용으로 덮어쓸까요?')) return
    setMessages((prev) => prev.map((m) => sendStatus[m.student_id] === 'success' ? m : { ...m, message: text }))
    toast.success(`${messages.length}명에게 공통 문자를 적용했습니다`)
  }

  async function copyMessage(studentId: string, text: string) {
    await navigator.clipboard.writeText(text)
    setCopiedId(studentId)
    setTimeout(() => setCopiedId(null), 2000)
    toast.success('클립보드에 복사했습니다')
  }

  async function sendOne(m: ClinicSmsMessage) {
    if (isSchedulePast) {
      toast.error('예약 시간은 현재 시간 이후로 설정해주세요')
      return
    }

    const keys = selectedRecipients[m.student_id] ?? new Set()
    if (!m.message.trim()) {
      toast.error(`${m.student_name}: 문자 내용을 입력해주세요`)
      return
    }

    const targets = (Array.from(keys) as RecipientKey[])
      .map((key) => {
        const phone = key === 'mother' ? m.mother_phone : key === 'father' ? m.father_phone : m.phone
        return phone ? {
          studentId: m.student_id,
          studentName: m.student_name,
          recipientLabel: RECIPIENT_LABEL[key],
          phone,
          message: m.message,
        } : null
      })
      .filter(Boolean)

    if (targets.length === 0) {
      toast.error(`${m.student_name}: 수신자를 선택해주세요`)
      return
    }

    setSendStatus((prev) => ({ ...prev, [m.student_id]: 'sending' }))
    setSendError((prev) => {
      const next = { ...prev }
      delete next[m.student_id]
      return next
    })

    try {
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets, scheduledDate: buildScheduledDate() }),
      })
      const results = await res.json()
      const allSuccess = results.every((r: { success: boolean }) => r.success)

      if (allSuccess) {
        setSendStatus((prev) => ({ ...prev, [m.student_id]: 'success' }))
        qc.invalidateQueries({ queryKey: ['message-logs'] })
        qc.invalidateQueries({ queryKey: ['message-logs-infinite'] })
      } else {
        const failedResults = results.filter((r: { success: boolean; error?: string }) => !r.success)
        setSendStatus((prev) => ({ ...prev, [m.student_id]: 'error' }))
        setSendError((prev) => ({ ...prev, [m.student_id]: failedResults[0]?.error ?? '발송 실패' }))
      }
    } catch {
      setSendStatus((prev) => ({ ...prev, [m.student_id]: 'error' }))
      setSendError((prev) => ({ ...prev, [m.student_id]: '네트워크 오류' }))
    }
  }

  async function sendAll() {
    if (isSchedulePast) {
      toast.error('예약 시간은 현재 시간 이후로 설정해주세요')
      return
    }
    const pending = messages.filter((m) => (sendStatus[m.student_id] ?? 'idle') !== 'success')
    if (pending.length === 0) return
    const totalTargets = pending.reduce((sum, m) => sum + (selectedRecipients[m.student_id]?.size ?? 0), 0)
    const confirmed = window.confirm(
      `${pending.length}명 ${totalTargets}건에게 ${scheduleEnabled ? '예약 발송' : '전체 발송'}하시겠습니까?`
    )
    if (!confirmed) return

    setSendingAll(true)
    for (const m of pending) {
      await sendOne(m)
    }
    setSendingAll(false)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpen}>
      <SheetTrigger asChild>
        {children ?? (
          <Button variant="outline">
            <CalendarCheck className="mr-2 h-4 w-4" />클리닉 문자
          </Button>
        )}
      </SheetTrigger>

      <SheetContent className="w-full sm:max-w-lg flex flex-col gap-0 p-0" showCloseButton={false}>
        <SheetHeader className="px-5 py-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle>{relativeDateLabel} 클리닉 안내 문자</SheetTitle>
              <p className="mt-1 text-xs text-gray-400">
                {formatDateLabel(date)}{slotLabel ? ` · ${slotLabel}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={loadMessages} disabled={loading || sendingAll} className="h-8 text-xs">
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />새로고침
              </Button>
              {messages.length > 0 && (
                <Button size="sm" onClick={sendAll} disabled={!hasSendableMessage || loading || sendingAll || (scheduleEnabled && isSchedulePast)} className="h-8 text-xs">
                  {sendingAll ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                  전체 발송
                </Button>
              )}
              <SheetClose asChild>
                <button className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close</span>
                </button>
              </SheetClose>
            </div>
          </div>
        </SheetHeader>

        {messages.length > 0 && !loading && (
          <div className="shrink-0 border-b bg-white px-5 py-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">공통 문자</p>
                <p className="mt-0.5 text-xs text-gray-400">{relativeDateLabel} 클리닉 대상 학생들에게 같은 내용을 적용합니다.</p>
              </div>
              <Button size="sm" onClick={applyTemplateToAll} disabled={!templateMessage.trim()} className="h-8 text-xs">
                <Check className="mr-1.5 h-3.5 w-3.5" />전체 적용
              </Button>
            </div>
            <Textarea
              value={templateMessage}
              onChange={(e) => setTemplateMessage(e.target.value)}
              placeholder={`예) ${relativeDateLabel} 클리닉은 예정대로 진행됩니다. 준비물 챙겨서 시간 맞춰 등원해주세요.`}
              rows={4}
              className="resize-none text-sm"
            />
            <div className="mt-1.5 flex items-center justify-end text-xs text-gray-400">
              <span className={templateMessage.length > 90 ? 'text-amber-500' : ''}>{templateMessage.length}자</span>
            </div>
          </div>
        )}

        {messages.length > 0 && !loading && (
          <div className="shrink-0 space-y-2 border-b bg-white px-5 py-2.5">
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox checked={scheduleEnabled} onCheckedChange={(v) => setScheduleEnabled(!!v)} />
              <span className="text-xs font-medium text-gray-700">예약 발송</span>
            </label>
            {scheduleEnabled && (
              <div className="ml-6 flex gap-2">
                <input
                  type="date"
                  value={scheduleDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="flex-1 rounded-md border border-input bg-white px-3 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <select
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="flex-1 rounded-md border border-input bg-white px-3 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
                </select>
              </div>
            )}
            {scheduleEnabled && isSchedulePast && (
              <p className="ml-6 text-xs text-red-500">현재 시간 이후로 설정해주세요</p>
            )}
          </div>
        )}

        {messages.length > 0 && !loading && (
          <div className="flex shrink-0 items-center gap-1.5 border-b bg-gray-50 px-5 py-2.5">
            <span className="mr-1 shrink-0 text-xs text-gray-400">전체 선택</span>
            {(['mother', 'father', 'student'] as RecipientKey[]).map((key) => {
              const { total } = typeStats[key]
              if (total === 0) return null
              const state = typeCheckState(key)
              return (
                <button
                  key={key}
                  onClick={() => toggleType(key)}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    state === true ? 'border-primary bg-primary/10 text-primary'
                    : state === 'indeterminate' ? 'border-primary/50 bg-primary/5 text-primary/70'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <span className={`flex h-3 w-3 items-center justify-center rounded-sm border ${
                    state === true ? 'border-primary bg-primary' : state === 'indeterminate' ? 'border-primary/50 bg-primary/10' : 'border-gray-300'
                  }`}>
                    {state === true && <span className="block h-1.5 w-1.5 rounded-sm bg-white" />}
                    {state === 'indeterminate' && <span className="block h-px w-2 bg-primary/70" />}
                  </span>
                  {RECIPIENT_LABEL[key]}
                  <span className={state ? 'text-primary/60' : 'text-gray-400'}>{total}</span>
                </button>
              )
            })}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-400">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm">{relativeDateLabel} 클리닉 대상자를 불러오고 있습니다...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-400">
              <CalendarCheck className="h-10 w-10 text-gray-200" />
              <p className="text-sm">{slotLabel === null ? `${relativeDateLabel} 운영 중인 클리닉이 없습니다` : `${relativeDateLabel} 클리닉 대상 학생이 없습니다`}</p>
            </div>
          ) : (
            <div className="divide-y">
              {messages.map((m) => {
                const status = sendStatus[m.student_id] ?? 'idle'
                const error = sendError[m.student_id]
                const keys = selectedRecipients[m.student_id] ?? new Set()
                const phones: { key: RecipientKey; phone: string | null }[] = [
                  { key: 'mother', phone: m.mother_phone },
                  { key: 'father', phone: m.father_phone },
                  { key: 'student', phone: m.phone },
                ]
                const available = phones.filter((phone) => !!phone.phone)

                return (
                  <div key={m.student_id} className={`space-y-2.5 px-5 py-4 ${status === 'success' ? 'bg-green-50/50' : status === 'error' ? 'bg-red-50/50' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 pt-0.5">
                        <span className="text-sm font-medium text-gray-900">{m.student_name}</span>
                        {status === 'success' && (
                          <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                            <Check className="h-3 w-3" />발송완료
                          </span>
                        )}
                        {status === 'error' && (
                          <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                            <XCircle className="h-3 w-3" />발송실패
                          </span>
                        )}
                      </div>
                      {available.length === 0 ? (
                        <span className="text-xs text-red-400">번호 없음</span>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-x-3 gap-y-1.5">
                          {available.map((phone) => (
                            <label key={phone.key} className="flex cursor-pointer select-none items-center gap-1.5">
                              <Checkbox
                                checked={keys.has(phone.key)}
                                onCheckedChange={() => toggleRecipient(m.student_id, phone.key)}
                                disabled={status === 'success'}
                                className="h-3.5 w-3.5"
                              />
                              <span className="text-xs font-medium text-gray-700">{RECIPIENT_LABEL[phone.key]}</span>
                              <span className="text-xs text-gray-400">{phone.phone}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    <Textarea
                      value={m.message}
                      onChange={(e) => updateMessage(m.student_id, e.target.value)}
                      rows={5}
                      className="resize-none text-sm"
                      disabled={status === 'success'}
                    />

                    <div className="flex items-center justify-between">
                      <span className={`text-xs ${m.message.length > 90 ? 'text-amber-500' : 'text-gray-400'}`}>
                        {m.message.length}자{m.message.length > 90 && ' (장문 LMS)'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {error && <span className="text-xs text-red-400">{error}</span>}
                        <Button size="sm" variant="outline" onClick={() => copyMessage(m.student_id, m.message)} className="h-7 text-xs" disabled={status === 'success'}>
                          {copiedId === m.student_id ? <><Check className="mr-1 h-3 w-3 text-green-600" />복사됨</> : <><Copy className="mr-1 h-3 w-3" />복사</>}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => sendOne(m)}
                          disabled={!m.message.trim() || keys.size === 0 || status === 'sending' || status === 'success' || (scheduleEnabled && (!scheduleDate || !scheduleTime || isSchedulePast))}
                          className={`h-7 text-xs ${status === 'success' ? 'bg-green-500 text-white hover:bg-green-500' : ''}`}
                        >
                          {status === 'sending' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                          {status === 'success' && <Check className="mr-1 h-3 w-3" />}
                          {(status === 'idle' || status === 'error') && <Send className="mr-1 h-3 w-3" />}
                          {status === 'sending' ? '처리 중' : status === 'success' ? (scheduleEnabled ? '예약 완료' : '발송 완료') : scheduleEnabled ? '예약' : '발송'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
