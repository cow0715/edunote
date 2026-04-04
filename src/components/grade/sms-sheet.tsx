'use client'

import { useState, useEffect, useMemo } from 'react'
import { MessageSquare, Copy, Check, RefreshCw, ChevronDown, ChevronUp, RotateCcw, Save, Send, XCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { useSaveMessageLog } from '@/hooks/use-message-logs'
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
}

type RecipientKey = 'mother' | 'father' | 'student'
type SendStatus = 'idle' | 'sending' | 'success' | 'error'

const RECIPIENT_LABEL: Record<RecipientKey, string> = { mother: '어머니', father: '아버지', student: '학생' }

interface Props {
  weekId: string
  weekNumber: number
}

export function SmsSheet({ weekId, weekNumber }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedRecipients, setSelectedRecipients] = useState<Record<string, Set<RecipientKey>>>({})
  const [sendStatus, setSendStatus] = useState<Record<string, SendStatus>>({})
  const [sendError, setSendError] = useState<Record<string, string>>({})
  const [promptText, setPromptText] = useState(SMS_RULES)
  const [promptOpen, setPromptOpen] = useState(false)
  const saveMessageLog = useSaveMessageLog()
  const { data: savedPrompt } = usePrompt(PROMPT_KEY)
  const savePrompt = useSavePrompt(PROMPT_KEY)

  useEffect(() => {
    if (savedPrompt) setPromptText(savedPrompt)
  }, [savedPrompt])

  const activePrompt = savedPrompt ?? SMS_RULES
  const isPromptModified = promptText !== activePrompt

  const sentCount = Object.values(sendStatus).filter((s) => s === 'success').length

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
        body: JSON.stringify({ customPrompt: promptText }),
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

  function handleOpen(v: boolean) {
    setOpen(v)
    if (v && messages.length === 0) generate()
    if (!v) { setSendStatus({}); setSendError({}) }
  }

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

  async function copyAll() {
    const all = messages.map((m) => `[${m.student_name}]\n${m.message}`).join('\n\n')
    await navigator.clipboard.writeText(all)
    toast.success(`${messages.length}명 문자 전체 복사됐습니다`)
  }

  async function sendOne(m: SmsMessage) {
    const keys = selectedRecipients[m.student_id] ?? new Set()
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
        body: JSON.stringify({ targets, weekId }),
      })
      const results = await res.json()
      const allSuccess = results.every((r: { success: boolean }) => r.success)

      if (allSuccess) {
        setSendStatus((prev) => ({ ...prev, [m.student_id]: 'success' }))
        await saveMessageLog.mutateAsync({ student_id: m.student_id, week_id: weekId, message: m.message })
      } else {
        const failedLabels = results.filter((r: { success: boolean }) => !r.success).map((r: { recipientLabel: string }) => r.recipientLabel).join(', ')
        setSendStatus((prev) => ({ ...prev, [m.student_id]: 'error' }))
        setSendError((prev) => ({ ...prev, [m.student_id]: `${failedLabels} 발송 실패` }))
      }
    } catch {
      setSendStatus((prev) => ({ ...prev, [m.student_id]: 'error' }))
      setSendError((prev) => ({ ...prev, [m.student_id]: '네트워크 오류' }))
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpen}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <MessageSquare className="mr-2 h-4 w-4" />문자 발송
        </Button>
      </SheetTrigger>

      <SheetContent className="w-full sm:max-w-lg flex flex-col gap-0 p-0">
        {/* ── 헤더: 제목 + 재생성 + 프롬프트 ── */}
        <SheetHeader className="px-5 py-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle>{weekNumber}주차 문자 발송</SheetTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={generate} disabled={loading} className="h-8 text-xs">
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />재생성
              </Button>
              {messages.length > 0 && (
                <Button size="sm" variant="outline" onClick={copyAll} className="h-8 text-xs">
                  <Copy className="mr-1.5 h-3.5 w-3.5" />전체 복사
                </Button>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPromptOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-md px-3 py-2 text-xs text-gray-500 hover:bg-gray-100 transition-colors mt-1"
          >
            <span className="flex items-center gap-1.5">
              프롬프트 수정
              {isPromptModified && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">미저장</span>}
            </span>
            {promptOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {promptOpen && (
            <div className="space-y-1.5 pt-1">
              <Textarea value={promptText} onChange={(e) => setPromptText(e.target.value)} rows={8} className="font-mono text-xs resize-none" spellCheck={false} />
              <div className="flex justify-between">
                <Button size="sm" variant="ghost" onClick={() => setPromptText(SMS_RULES)} className="h-7 text-xs text-gray-400 hover:text-gray-600">
                  <RotateCcw className="mr-1 h-3 w-3" />기본값으로 되돌리기
                </Button>
                <Button size="sm" onClick={() => savePrompt.mutate(promptText)} disabled={savePrompt.isPending || !isPromptModified} className="h-7 text-xs">
                  <Save className="mr-1 h-3 w-3" />저장
                </Button>
              </div>
            </div>
          )}
        </SheetHeader>

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
              <p className="text-sm">Claude가 문자를 작성하고 있어요...</p>
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
                          disabled={keys.size === 0 || status === 'sending' || status === 'success'}
                          className={`h-7 text-xs ${status === 'success' ? 'bg-green-500 hover:bg-green-500 text-white' : ''}`}
                        >
                          {status === 'sending' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                          {status === 'success' && <Check className="mr-1 h-3 w-3" />}
                          {(status === 'idle' || status === 'error') && <Send className="mr-1 h-3 w-3" />}
                          {status === 'sending' ? '발송 중' : status === 'success' ? '발송 완료' : '발송'}
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
