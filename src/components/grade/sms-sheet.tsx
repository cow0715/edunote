'use client'

import React, { useState, useMemo } from 'react'
import { MessageSquare, Copy, Check, RefreshCw, Send, XCircle, Loader2, X, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { usePrompt } from '@/hooks/use-prompts'
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

function formatWrongItems(data: SmsStudentData) {
  const wrongObjective = data.reading.wrong_objective.map((w) =>
    `${w.question_number}번 ${w.concept_tag ?? w.concept_category}`
  )
  const wrongSubjective = data.reading.wrong_subjective.map((w) =>
    `${w.question_number}번 ${w.ai_feedback || w.concept_category}`
  )
  return [...wrongObjective, ...wrongSubjective]
}

function formatWrongSummary(data: SmsStudentData) {
  const wrongItems = formatWrongItems(data)
  if (wrongItems.length === 0) return '없음'
  return wrongItems.slice(0, 3).join(', ') + (wrongItems.length > 3 ? ` 외 ${wrongItems.length - 3}개` : '')
}

function buildMessageFromTemplate(template: string, data: SmsStudentData | null) {
  const trimmedTemplate = template.trim()
  if (!data) return trimmedTemplate

  const vocabChange = data.vocab.prev_correct !== null
    ? ` (${data.vocab.correct - data.vocab.prev_correct >= 0 ? '+' : ''}${data.vocab.correct - data.vocab.prev_correct})`
    : ''
  const statusLine = data.is_absent
    ? '상태: 결석'
    : data.is_unexamined
    ? '상태: 미응시'
    : null
  const homeworkLine = data.homework.total > 0
    ? `${data.homework.done}/${data.homework.total}`
    : '완료'

  const lines = [
    trimmedTemplate,
    '',
    '[이번 주 학습 데이터]',
    statusLine,
    `단어: ${data.vocab.correct}/${data.vocab.total}${vocabChange}`,
    `독해: ${data.reading.correct}/${data.reading.total}`,
    `오답 포인트: ${formatWrongSummary(data)}`,
    `숙제: ${homeworkLine}`,
    data.teacher_memo ? `메모: ${data.teacher_memo}` : null,
    `확인 링크: ${data.share_url}`,
  ].filter(Boolean)

  return lines.join('\n')
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
  const { data: savedPrompt } = usePrompt(PROMPT_KEY)
  const sentCount = Object.values(sendStatus).filter((s) => s === 'success').length
  const hasSendableMessage = messages.some((m) => m.message.trim() && sendStatus[m.student_id] !== 'success')

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
      const ok = window.confirm(`이미 ${sentCount}명에게 발송되었습니다.\nAI로 다시 생성하면 발송 상태가 초기화됩니다. 계속할까요?`)
      if (!ok) return
    }
    const basePrompt = savedPrompt ?? SMS_RULES
    const customPrompt = templateMessage.trim()
      ? `${basePrompt}

추가 지시:
아래 강사 메시지를 문자 맨 앞에 먼저 배치하고, 그 아래에 학생별 데이터를 정돈된 형식으로 붙여 주세요.
- 강사 메시지는 핵심 의미와 말투를 유지하되 너무 어색한 부분만 가볍게 다듬으세요.
- 학생별 본문을 새로 길게 창작하지 말고, 데이터 요약은 아래 형식을 최대한 지키세요.
- 데이터가 없는 항목은 억지로 평가하지 말고 자연스럽게 생략하거나 "없음"으로 처리하세요.
- 문항 번호와 원점수 나열은 피하고, 오답은 개념/유형 중심으로 짧게 적으세요.
- 개인 결과 확인 링크는 반드시 마지막 줄에 포함하세요.

권장 형식:
{강사 메시지}

[이번 주 학습 데이터]
단어: n/n
독해: n/n
오답 포인트: 개념/유형 요약
숙제: n/n
메모: 필요한 경우만
확인 링크: {링크}

[강사 공통 문구]
${templateMessage.trim()}`
      : basePrompt

    setLoading(true)
    setAiGenerating(true)
    try {
      const res = await fetch(`/api/weeks/${weekId}/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'ai', customPrompt }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const data = await res.json()
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
      toast.success('학생 데이터로 AI 문자를 생성했습니다')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'AI 문자 생성에 실패했습니다')
    } finally {
      setAiGenerating(false)
      setLoading(false)
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

  function applyTemplateToAll() {
    const text = templateMessage.trim()
    if (!text) {
      toast.error('공통 문자 내용을 입력해주세요')
      return
    }
    const hasEditedMessages = messages.some((m) => m.message.trim() && sendStatus[m.student_id] !== 'success')
    if (hasEditedMessages && !window.confirm('작성된 학생별 문자를 공통 내용으로 덮어쓸까요?')) return
    setMessages((prev) => prev.map((m) => (
      sendStatus[m.student_id] === 'success' ? m : { ...m, message: buildMessageFromTemplate(text, m.student_data) }
    )))
    toast.success(`${messages.length}명에게 학생별 데이터 문자를 적용했습니다`)
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

  async function sendAll() {
    if (isSchedulePast) {
      toast.error('예약 시간은 현재 시간 이후로 설정해주세요')
      return
    }
    const pending = messages.filter((m) => (sendStatus[m.student_id] ?? 'idle') !== 'success')
    if (pending.length === 0) return
    const totalTargets = pending.reduce((sum, m) => sum + (selectedRecipients[m.student_id]?.size ?? 0), 0)
    const confirmed = window.confirm(
      `${pending.length}명(${totalTargets}건)에게 ${scheduleEnabled ? '예약 발송' : '전체 발송'}하시겠습니까?`
    )
    if (!confirmed) return
    setSendingAll(true)
    for (const m of pending) {
      await sendOne(m)
    }
    setSendingAll(false)
  }

  async function copyMessage(studentId: string, text: string) {
    await navigator.clipboard.writeText(text)
    setCopiedId(studentId)
    setTimeout(() => setCopiedId(null), 2000)
    toast.success('클립보드에 복사됐습니다')
  }

  async function copyAll() {
    const all = messages.map((m) => `[${m.student_name}]\n${m.message}`).join('\n\n')
    await navigator.clipboard.writeText(all)
    toast.success(`${messages.length}명 문자 전체 복사됐습니다`)
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
              <Button size="sm" variant="ghost" onClick={generate} disabled={loading || sendingAll} className="h-8 text-xs">
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />재생성
              </Button>
              {messages.length > 0 && (
                <>
                  <Button size="sm" variant="outline" onClick={copyAll} className="h-8 text-xs">
                    <Copy className="mr-1.5 h-3.5 w-3.5" />전체 복사
                  </Button>
                  <Button size="sm" onClick={sendAll} disabled={!hasSendableMessage || loading || sendingAll || (scheduleEnabled && isSchedulePast)} className="h-8 text-xs">
                    {sendingAll ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                    전체 발송
                  </Button>
                </>
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
                <Button size="sm" variant="outline" onClick={generateWithAi} disabled={loading || sendingAll} className="h-8 text-xs">
                  {aiGenerating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                  AI로 다듬기
                </Button>
                <Button size="sm" onClick={applyTemplateToAll} disabled={!templateMessage.trim()} className="h-8 text-xs">
                  <Check className="mr-1.5 h-3.5 w-3.5" />데이터 붙이기
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
              <span>데이터 붙이기는 정해진 형식으로 만들고, AI는 같은 형식을 조금 더 자연스럽게 다듬습니다.</span>
              <span className={templateMessage.length > 90 ? 'text-amber-500' : ''}>{templateMessage.length}자</span>
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
                const data = m.student_data
                const wrongItems = data ? formatWrongItems(data) : []

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

                    {data && (
                      <div className="rounded-lg bg-gray-50 px-3 py-2.5">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-gray-700">학생 개인 데이터</p>
                          {(data.is_absent || data.is_unexamined) && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                              {data.is_absent ? '결석' : '미응시'}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <p className="text-gray-400">단어</p>
                            <p className="font-semibold text-gray-900">
                              {data.vocab.correct}/{data.vocab.total}
                              {data.vocab.prev_correct !== null && (
                                <span className="ml-1 font-medium text-gray-400">
                                  {data.vocab.correct - data.vocab.prev_correct >= 0 ? '+' : ''}
                                  {data.vocab.correct - data.vocab.prev_correct}
                                </span>
                              )}
                            </p>
                          </div>
                          <div>
                            <p className="text-gray-400">독해</p>
                            <p className="font-semibold text-gray-900">{data.reading.correct}/{data.reading.total}</p>
                          </div>
                          <div>
                            <p className="text-gray-400">숙제</p>
                            <p className="font-semibold text-gray-900">
                              {data.homework.total > 0 ? `${data.homework.done}/${data.homework.total}` : '완료'}
                            </p>
                          </div>
                        </div>
                        {wrongItems.length > 0 && (
                          <p className="mt-2 text-xs leading-relaxed text-gray-500">
                            오답: {wrongItems.slice(0, 5).join(', ')}
                            {wrongItems.length > 5 ? ` 외 ${wrongItems.length - 5}개` : ''}
                          </p>
                        )}
                        {data.teacher_memo && (
                          <p className="mt-1.5 text-xs leading-relaxed text-gray-500">메모: {data.teacher_memo}</p>
                        )}
                        <p className="mt-1.5 truncate text-xs text-blue-600">{data.share_url}</p>
                      </div>
                    )}

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
