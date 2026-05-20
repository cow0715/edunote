'use client'

import React, { useState, useMemo, useEffect } from 'react'
import { MessageSquare, Copy, Check, Send, XCircle, Loader2, X, Sparkles, ChevronDown, ChevronUp, RotateCcw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { usePrompt, useSavePrompt } from '@/hooks/use-prompts'
import { SMS_RULES } from '@/lib/prompts'

const PROMPT_KEY = 'sms_rules'

type SmsMessage = {
  student_id: string
  student_name: string
  phone: string | null
  father_phone: string | null
  mother_phone: string | null
  message: string
  student_data: SmsStudentData | null
}

type RecipientKey = 'mother' | 'father' | 'student'
type SendStatus = 'idle' | 'sending' | 'success' | 'error'

type SmsMeta = {
  class_name: string
  week_label: string
  start_date: string | null
}

type SmsStudentData = {
  is_absent?: boolean
  is_unexamined?: boolean
  vocab: { correct: number; total: number; prev_correct: number | null }
  reading: {
    correct: number
    total: number
    wrong_objective: { question_number: number; concept_category: string; concept_tag: string | null }[]
    wrong_subjective: { question_number: number; concept_category: string; ai_feedback: string }[]
  }
  homework: { done: number; total: number }
  teacher_memo: string | null
  share_url: string
}

const RECIPIENT_LABEL: Record<RecipientKey, string> = { mother: '어머니', father: '아버지', student: '학생' }

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2).toString().padStart(2, '0')
  const m = i % 2 === 0 ? '00' : '30'
  return `${h}:${m}`
})

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

function formatFeedbackDate(startDate?: string | null) {
  if (!startDate) return ''
  const date = new Date(startDate)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}/${day}`
}

function normalizeTemplateBody(template: string) {
  const lines = template
    .split('\n')
    .map((line) => line.trim().replace(/^◆\s*/, ''))
    .filter(Boolean)

  const bulletLines = template
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('◆'))

  if (bulletLines.length >= 2) {
    return bulletLines[1].replace(/^◆\s*/, '').replace(/\s+/g, ' ').trim()
  }

  return lines
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildMessageFromTemplate(template: string, studentName: string, data: SmsStudentData | null, meta: SmsMeta | null) {
  const body = normalizeTemplateBody(template)
  if (!body) return ''

  const dateLabel = formatFeedbackDate(meta?.start_date)
  const dateText = dateLabel ? `${dateLabel} 일자 ` : ''
  const shareUrl = data?.share_url ?? ''

  return [
    `◆ ${studentName} 학생 및 학부모님 안녕하세요. 미탐 영어 추지혜T입니다. ${dateText}수업피드백 드립니다.`,
    `◆ ${body}`,
    '◆ 아래 링크를 통해 학습현황을 확인하실 수 있습니다.',
    shareUrl,
    '◆ 학업과 관련하여 상담이 필요하신 학부모님은 회신 주시면 연락드리도록 하겠습니다.',
  ].filter(Boolean).join('\n')
}

interface Props {
  weekId: string
  weekNumber: number
  weekLabel?: string
  children?: React.ReactNode
}

export function SmsSheet({ weekId, weekNumber, weekLabel, children }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedRecipients, setSelectedRecipients] = useState<Record<string, Set<RecipientKey>>>({})
  const [sendStatus, setSendStatus] = useState<Record<string, SendStatus>>({})
  const [sendError, setSendError] = useState<Record<string, string>>({})
  const [sendingAll, setSendingAll] = useState(false)
  const [aiGenerating, setAiGenerating] = useState(false)
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleDate, setScheduleDate] = useState(() => getNearestSchedule().date)
  const [scheduleTime, setScheduleTime] = useState(() => getNearestSchedule().time)
  const [templateMessage, setTemplateMessage] = useState('')
  const [smsMeta, setSmsMeta] = useState<SmsMeta | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptText, setPromptText] = useState(SMS_RULES)
  const { data: savedPrompt } = usePrompt(PROMPT_KEY)
  const savePrompt = useSavePrompt(PROMPT_KEY)
  const activePrompt = savedPrompt ?? SMS_RULES
  const isPromptModified = promptText !== activePrompt
  const sentCount = Object.values(sendStatus).filter((s) => s === 'success').length
  const hasSendableMessage = messages.some((m) => m.message.trim() && sendStatus[m.student_id] !== 'success')

  useEffect(() => {
    setPromptText(savedPrompt ?? SMS_RULES)
  }, [savedPrompt])

  async function generate() {
    if (sentCount > 0) {
      const ok = window.confirm(`이미 ${sentCount}명에게 발송됐습니다.\n재생성하면 발송 상태가 초기화됩니다. 계속할까요?`)
      if (!ok) return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/weeks/${weekId}/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const data = await res.json()
      setMessages(data.messages)
      setSmsMeta({ class_name: data.class_name, week_label: data.week_label, start_date: data.start_date })
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
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'SMS 생성에 실패했습니다')
    } finally {
      setLoading(false)
    }
  }

  async function generateWithAi() {
    if (sentCount > 0) {
      const ok = window.confirm(`이미 ${sentCount}명에게 발송되었습니다.\nAI로 다시 적용하면 발송 상태가 초기화됩니다. 계속할까요?`)
      if (!ok) return
    }
    const text = templateMessage.trim()
    if (!text) {
      toast.error('다듬을 공통 문자 내용을 입력해주세요')
      return
    }

    setAiGenerating(true)
    try {
      const res = await fetch('/api/sms/refine-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, rules: activePrompt }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const data = await res.json()
      const refinedText = data.text || text
      setTemplateMessage(refinedText)
      setMessages((prev) => prev.map((m) => (
        sendStatus[m.student_id] === 'success'
          ? m
          : { ...m, message: buildMessageFromTemplate(refinedText, m.student_name, m.student_data, smsMeta) }
      )))
      setSendStatus({})
      setSendError({})
      toast.success('AI로 다듬은 문구를 학생별 문자에 적용했습니다')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'AI 문구 다듬기에 실패했습니다')
    } finally {
      setAiGenerating(false)
    }
  }

  function handleOpen(v: boolean) {
    setOpen(v)
    if (v && messages.length === 0) generate()
    if (!v) { setSendStatus({}); setSendError({}); setScheduleEnabled(false); const ns = getNearestSchedule(); setScheduleDate(ns.date); setScheduleTime(ns.time) }
  }

  function buildScheduledDate() {
    if (!scheduleEnabled || !scheduleDate || !scheduleTime) return undefined
    return `${scheduleDate}T${scheduleTime}:00+09:00`
  }

  const isSchedulePast = useMemo(() => {
    if (!scheduleEnabled || !scheduleDate || !scheduleTime) return false
    return new Date(`${scheduleDate}T${scheduleTime}:00+09:00`).getTime() <= Date.now()
  }, [scheduleEnabled, scheduleDate, scheduleTime])

  function updateMessage(studentId: string, text: string) {
    setMessages((prev) => prev.map((m) => m.student_id === studentId ? { ...m, message: text } : m))
  }

  function toggleRecipient(studentId: string, key: RecipientKey) {
    setSelectedRecipients((prev) => {
      const next = { ...prev }
      const s = new Set(next[studentId] ?? [])
      if (s.has(key)) s.delete(key)
      else s.add(key)
      next[studentId] = s
      return next
    })
  }

  // 전체 타입별 빠른 선택
  const typeStats = useMemo(() => {
    const stats: Record<RecipientKey, { total: number; selected: number }> = {
      mother: { total: 0, selected: 0 },
      father: { total: 0, selected: 0 },
      student: { total: 0, selected: 0 },
    }
    for (const m of messages) {
      const phoneMap: Record<RecipientKey, string | null> = { mother: m.mother_phone, father: m.father_phone, student: m.phone }
      for (const key of (['mother', 'father', 'student'] as RecipientKey[])) {
        if (phoneMap[key]) {
          stats[key].total++
          if (selectedRecipients[m.student_id]?.has(key)) stats[key].selected++
        }
      }
    }
    return stats
  }, [messages, selectedRecipients])

  function typeCheckState(key: RecipientKey): boolean | 'indeterminate' {
    const { total, selected } = typeStats[key]
    if (total === 0) return false
    if (selected === 0) return false
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
        const s = new Set(next[m.student_id] ?? [])
        if (allChecked) s.delete(key)
        else s.add(key)
        next[m.student_id] = s
      }
      return next
    })
  }

  async function copyMessage(studentId: string, text: string) {
    await navigator.clipboard.writeText(text)
    setCopiedId(studentId)
    setTimeout(() => setCopiedId(null), 2000)
    toast.success('클립보드에 복사됐습니다')
  }

  async function sendOne(m: SmsMessage) {
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
      .map((k) => {
        const phone = k === 'mother' ? m.mother_phone : k === 'father' ? m.father_phone : m.phone
        return phone ? { studentId: m.student_id, studentName: m.student_name, recipientLabel: RECIPIENT_LABEL[k], phone, message: m.message } : null
      })
      .filter(Boolean)

    if (targets.length === 0) {
      toast.error(`${m.student_name}: 수신자를 선택해주세요`)
      return
    }

    setSendStatus((prev) => ({ ...prev, [m.student_id]: 'sending' }))
    setSendError((prev) => { const n = { ...prev }; delete n[m.student_id]; return n })

    try {
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets, weekId, scheduledDate: buildScheduledDate() }),
      })
      const results = await res.json()
      const allSuccess = results.every((r: { success: boolean }) => r.success)

      if (allSuccess) {
        setSendStatus((prev) => ({ ...prev, [m.student_id]: 'success' }))
      } else {
        const failedResults = results.filter((r: { success: boolean; error?: string }) => !r.success)
        const errorMsg = failedResults[0]?.error ?? '발송 실패'
        setSendStatus((prev) => ({ ...prev, [m.student_id]: 'error' }))
        setSendError((prev) => ({ ...prev, [m.student_id]: errorMsg }))
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
            <MessageSquare className="mr-2 h-4 w-4" />문자 발송
          </Button>
        )}
      </SheetTrigger>

      <SheetContent className="w-full sm:max-w-lg flex flex-col gap-0 p-0" showCloseButton={false}>
        {/* ── 헤더: 제목 + 재생성 + 프롬프트 ── */}
        <SheetHeader className="px-5 py-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle>{weekLabel ?? `${weekNumber}주차`} 문자 발송</SheetTitle>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <Button size="sm" onClick={sendAll} disabled={!hasSendableMessage || loading || sendingAll || (scheduleEnabled && isSchedulePast)} className="h-8 text-xs">
                  {sendingAll ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                  전체 발송
                </Button>
              )}
              <SheetClose asChild>
                <button className="rounded p-1.5 hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600">
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
                <p className="text-sm font-semibold text-gray-900">공통 문자 템플릿</p>
                <p className="mt-0.5 text-xs text-gray-400">강사 메시지를 먼저 두고, 아래에 학생별 학습 데이터를 붙입니다.</p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" onClick={generateWithAi} disabled={loading || sendingAll || aiGenerating || !templateMessage.trim()} className="h-8 text-xs">
                  {aiGenerating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                  AI로 다듬기
                </Button>
              </div>
            </div>
            <Textarea
              value={templateMessage}
              onChange={(e) => setTemplateMessage(e.target.value)}
              placeholder="예) 오늘 수업에서는 지난주보다 문장 해석 흐름을 더 안정적으로 잡는 연습을 했습니다. 아래 개인 결과를 확인하고 부족한 부분만 복습해주세요."
              rows={4}
              className="resize-none text-sm"
            />
            <div className="mt-1.5 flex items-center justify-between text-xs text-gray-400">
              <span>AI로 다듬기를 누르면 학생별 이름·날짜·개인 링크까지 넣어 문자를 완성합니다.</span>
              <span className={templateMessage.length > 90 ? 'text-amber-500' : ''}>{templateMessage.length}자</span>
            </div>

            <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-white">
              <button
                type="button"
                onClick={() => setPromptOpen((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-xs text-gray-500 transition-colors hover:bg-gray-50"
              >
                <span className="flex items-center gap-1.5">
                  문자 프롬프트 수정
                  {isPromptModified && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">미저장</span>
                  )}
                </span>
                {promptOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>

              {promptOpen && (
                <div className="max-h-[44vh] overflow-y-auto overscroll-contain border-t border-gray-200">
                  <div className="border-b border-gray-100 px-3 py-2">
                    <p className="text-[11px] text-gray-400">AI로 다듬기부터 적용됩니다. 저장 후 바로 생성해도 최신 프롬프트를 사용합니다.</p>
                  </div>
                  <Textarea
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    className="min-h-[220px] resize-y rounded-none border-0 bg-gray-50 font-mono text-xs leading-relaxed focus-visible:ring-0"
                    spellCheck={false}
                  />
                  <div className="sticky bottom-0 flex justify-between border-t border-gray-200 bg-white px-3 py-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPromptText(SMS_RULES)}
                      className="h-7 text-xs text-gray-400 hover:text-gray-600"
                    >
                      <RotateCcw className="mr-1 h-3 w-3" />
                      기본값으로 되돌리기
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => savePrompt.mutate(promptText)}
                      disabled={savePrompt.isPending || !isPromptModified}
                      className="h-7 text-xs"
                    >
                      <Save className="mr-1 h-3 w-3" />
                      저장
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 예약 발송 토글 ── */}
        {messages.length > 0 && !loading && (
          <div className="px-5 py-2.5 border-b bg-white shrink-0 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={scheduleEnabled}
                onCheckedChange={(v) => setScheduleEnabled(!!v)}
              />
              <span className="text-xs font-medium text-gray-700">예약 발송</span>
            </label>
            {scheduleEnabled && (
              <div className="flex gap-2 ml-6">
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
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}
            {scheduleEnabled && isSchedulePast && (
              <p className="ml-6 text-xs text-red-500">현재 시간 이후로 설정해주세요</p>
            )}
          </div>
        )}

        {/* ── 빠른 선택 (메시지 있을 때만) ── */}
        {messages.length > 0 && !loading && (
          <div className="flex items-center gap-1.5 px-5 py-2.5 border-b bg-gray-50 shrink-0">
            <span className="text-xs text-gray-400 mr-1 shrink-0">전체 선택</span>
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

        {/* ── 메시지 목록 ── */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-400">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm">{aiGenerating ? 'AI가 학생 데이터로 문자를 작성하고 있습니다...' : '학생별 데이터를 불러오고 있습니다...'}</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-sm text-gray-400">채점 완료된 학생이 없습니다</div>
          ) : (
            <div className="divide-y">
              {messages.map((m) => {
                const status = sendStatus[m.student_id] ?? 'idle'
                const error = sendError[m.student_id]
                const keys = selectedRecipients[m.student_id] ?? new Set()
                const PHONES: { key: RecipientKey; phone: string | null }[] = [
                  { key: 'mother', phone: m.mother_phone },
                  { key: 'father', phone: m.father_phone },
                  { key: 'student', phone: m.phone },
                ]
                const available = PHONES.filter((p) => !!p.phone)
                return (
                  <div key={m.student_id} className={`px-5 py-4 space-y-2.5 ${status === 'success' ? 'bg-green-50/50' : status === 'error' ? 'bg-red-50/50' : ''}`}>
                    {/* 학생명 + 발송 상태 + 수신자 선택 */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 pt-0.5">
                        <span className="font-medium text-gray-900 text-sm">{m.student_name}</span>
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
                        <div className="flex flex-wrap gap-x-3 gap-y-1.5 justify-end">
                          {available.map((p) => (
                            <label key={p.key} className="flex items-center gap-1.5 cursor-pointer select-none">
                              <Checkbox
                                checked={keys.has(p.key)}
                                onCheckedChange={() => toggleRecipient(m.student_id, p.key)}
                                disabled={status === 'success'}
                                className="h-3.5 w-3.5"
                              />
                              <span className="text-xs font-medium text-gray-700">{RECIPIENT_LABEL[p.key]}</span>
                              <span className="text-xs text-gray-400">{p.phone}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    <Textarea
                      value={m.message}
                      onChange={(e) => updateMessage(m.student_id, e.target.value)}
                      rows={5}
                      className="text-sm resize-none"
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
                          className={`h-7 text-xs ${status === 'success' ? 'bg-green-500 hover:bg-green-500 text-white' : ''}`}
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
