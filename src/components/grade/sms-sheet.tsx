'use client'

import { useState, useEffect } from 'react'
import { MessageSquare, Copy, Check, RefreshCw, Phone, SendHorizonal, ChevronDown, ChevronUp, RotateCcw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
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

interface Props {
  weekId: string
  weekNumber: number
}

export function SmsSheet({ weekId, weekNumber }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())
  const [promptText, setPromptText] = useState(SMS_RULES)
  const [promptOpen, setPromptOpen] = useState(false)
  const saveMessageLog = useSaveMessageLog()
  const { data: savedPrompt } = usePrompt(PROMPT_KEY)
  const savePrompt = useSavePrompt(PROMPT_KEY)

  // DB에 저장된 프롬프트가 있으면 로드
  useEffect(() => {
    if (savedPrompt) setPromptText(savedPrompt)
  }, [savedPrompt])

  const activePrompt = savedPrompt ?? SMS_RULES
  const isPromptModified = promptText !== activePrompt

  async function generate() {
    setLoading(true)
    try {
      const body = JSON.stringify({ customPrompt: promptText })
      const res = await fetch(`/api/weeks/${weekId}/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const data = await res.json()
      setMessages(data.messages)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'SMS 생성에 실패했습니다')
    } finally {
      setLoading(false)
    }
  }

  function handleOpen(v: boolean) {
    setOpen(v)
    if (v && messages.length === 0) generate()
    if (!v) setSentIds(new Set())
  }

  async function markSent(m: SmsMessage) {
    await saveMessageLog.mutateAsync({ student_id: m.student_id, week_id: weekId, message: m.message })
    setSentIds((prev) => new Set(prev).add(m.student_id))
  }

  function updateMessage(studentId: string, text: string) {
    setMessages((prev) =>
      prev.map((m) => m.student_id === studentId ? { ...m, message: text } : m)
    )
  }

  async function copyMessage(studentId: string, text: string) {
    await navigator.clipboard.writeText(text)
    setCopiedId(studentId)
    setTimeout(() => setCopiedId(null), 2000)
    toast.success('클립보드에 복사됐습니다')
  }

  async function copyAll() {
    const all = messages
      .map((m) => `[${m.student_name}]\n${m.message}`)
      .join('\n\n')
    await navigator.clipboard.writeText(all)
    toast.success(`${messages.length}명 문자 전체 복사됐습니다`)
  }

  const primaryPhone = (m: SmsMessage) =>
    m.mother_phone ?? m.father_phone ?? m.phone

  return (
    <Sheet open={open} onOpenChange={handleOpen}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <MessageSquare className="mr-2 h-4 w-4" />
          문자 생성
        </Button>
      </SheetTrigger>

      <SheetContent className="w-full sm:max-w-lg flex flex-col gap-0 p-0">
        <SheetHeader className="px-5 py-4 border-b overflow-y-auto max-h-[60vh] shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle>{weekNumber}주차 문자 발송</SheetTitle>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={generate}
                disabled={loading}
                className="h-8 text-xs"
              >
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                재생성
              </Button>
              {messages.length > 0 && (
                <Button size="sm" variant="outline" onClick={copyAll} className="h-8 text-xs">
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  전체 복사
                </Button>
              )}
            </div>
          </div>

          {/* 프롬프트 편집 */}
          <button
            type="button"
            onClick={() => setPromptOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-md px-3 py-2 text-xs text-gray-500 hover:bg-gray-100 transition-colors mt-1"
          >
            <span className="flex items-center gap-1.5">
              프롬프트 수정
              {isPromptModified && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">미저장</span>
              )}
            </span>
            {promptOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {promptOpen && (
            <div className="space-y-1.5 pt-1">
              <Textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                rows={10}
                className="font-mono text-xs resize-none"
                spellCheck={false}
              />
              <div className="flex justify-between">
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
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-400">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm">Claude가 문자를 작성하고 있어요...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-sm text-gray-400">
              채점 완료된 학생이 없습니다
            </div>
          ) : (
            <div className="divide-y">
              {messages.map((m) => (
                <div key={m.student_id} className="px-5 py-4 space-y-2.5">
                  {/* 학생 정보 */}
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900 text-sm">{m.student_name}</span>
                    {primaryPhone(m) && (
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <Phone className="h-3 w-3" />
                        {primaryPhone(m)}
                      </span>
                    )}
                  </div>

                  {/* 문자 내용 */}
                  <Textarea
                    value={m.message}
                    onChange={(e) => updateMessage(m.student_id, e.target.value)}
                    rows={5}
                    className="text-sm resize-none"
                  />

                  {/* 글자 수 + 버튼 */}
                  <div className="flex items-center justify-between">
                    <span className={`text-xs ${m.message.length > 90 ? 'text-amber-500' : 'text-gray-400'}`}>
                      {m.message.length}자
                      {m.message.length > 90 && ' (장문 LMS)'}
                    </span>
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyMessage(m.student_id, m.message)}
                        className="h-7 text-xs"
                      >
                        {copiedId === m.student_id ? (
                          <><Check className="mr-1 h-3 w-3 text-green-600" />복사됨</>
                        ) : (
                          <><Copy className="mr-1 h-3 w-3" />복사</>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant={sentIds.has(m.student_id) ? 'default' : 'outline'}
                        onClick={() => markSent(m)}
                        disabled={sentIds.has(m.student_id) || saveMessageLog.isPending}
                        className="h-7 text-xs"
                      >
                        {sentIds.has(m.student_id) ? (
                          <><Check className="mr-1 h-3 w-3" />전송 완료</>
                        ) : (
                          <><SendHorizonal className="mr-1 h-3 w-3" />전송 완료</>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {messages.length > 0 && (
          <div className="border-t px-5 py-3 bg-gray-50">
            <p className="text-xs text-gray-400 text-center">
              복사 후 뿌리오에 붙여넣어 발송하세요
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
