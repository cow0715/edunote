'use client'

import { useState, useMemo } from 'react'
import { Megaphone, CheckCircle2, XCircle, Loader2, ChevronRight, ChevronLeft, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useClasses } from '@/hooks/use-classes'
import { useQueryClient } from '@tanstack/react-query'
import { Student } from '@/lib/types'
import { toast } from 'sonner'

type ClassWithStudents = {
  id: string
  name: string
  students: Student[]
}

type SendResult = {
  studentId: string
  studentName: string
  phone: string
  message: string
  success: boolean
  error?: string
}

type Step = 'select' | 'compose' | 'result'

export function BroadcastDialog() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('select')
  const [selectedTab, setSelectedTab] = useState('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState<SendResult[]>([])
  const [classesWithStudents, setClassesWithStudents] = useState<ClassWithStudents[]>([])
  const [loadingStudents, setLoadingStudents] = useState(false)

  const { data: classes = [] } = useClasses()
  const qc = useQueryClient()

  async function handleOpen(v: boolean) {
    setOpen(v)
    if (v) {
      reset()
      await loadStudents()
    }
  }

  async function loadStudents() {
    setLoadingStudents(true)
    try {
      const results = await Promise.all(
        classes.map(async (c) => {
          const res = await fetch(`/api/classes/${c.id}/students`)
          const data = await res.json()
          const students: Student[] = data.map((cs: { student: Student }) => cs.student).filter(Boolean)
          return { id: c.id, name: c.name, students }
        })
      )
      setClassesWithStudents(results)
    } finally {
      setLoadingStudents(false)
    }
  }

  function reset() {
    setStep('select')
    setSelectedTab('all')
    setSelectedIds(new Set())
    setMessage('')
    setResults([])
  }

  const allStudents = useMemo(() => {
    const map = new Map<string, Student>()
    classesWithStudents.forEach((c) => c.students.forEach((s) => map.set(s.id, s)))
    return Array.from(map.values())
  }, [classesWithStudents])

  const visibleStudents = useMemo(() => {
    if (selectedTab === 'all') return allStudents
    const c = classesWithStudents.find((c) => c.id === selectedTab)
    return c?.students ?? []
  }, [selectedTab, allStudents, classesWithStudents])

  const phoneOf = (s: Student) => s.mother_phone ?? s.father_phone ?? s.phone

  const selectableIds = useMemo(
    () => visibleStudents.filter((s) => !!phoneOf(s)).map((s) => s.id),
    [visibleStudents]
  )

  const allVisibleChecked =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id))

  function toggleAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allVisibleChecked) selectableIds.forEach((id) => next.delete(id))
      else selectableIds.forEach((id) => next.add(id))
      return next
    })
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedStudents = allStudents.filter((s) => selectedIds.has(s.id))

  async function send() {
    setSending(true)
    try {
      const targets = selectedStudents.map((s) => ({
        studentId: s.id,
        studentName: s.name,
        phone: phoneOf(s)!,
        message,
      }))

      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets }),
      })
      const data: SendResult[] = await res.json()
      setResults(data)
      setStep('result')
      qc.invalidateQueries({ queryKey: ['message-logs'] })
    } catch {
      toast.error('발송 중 오류가 발생했습니다')
    } finally {
      setSending(false)
    }
  }

  const successCount = results.filter((r) => r.success).length
  const failCount = results.filter((r) => !r.success).length

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button>
          <Megaphone className="mr-2 h-4 w-4" />
          공지 발송
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="text-base font-semibold">
            {step === 'select' && '받는 사람 선택'}
            {step === 'compose' && '메시지 작성'}
            {step === 'result' && '발송 결과'}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: 받는 사람 선택 */}
        {step === 'select' && (
          <>
            <div className="flex-1 overflow-y-auto max-h-[60vh]">
              {loadingStudents ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
                </div>
              ) : (
                <>
                  {/* 반 탭 */}
                  <div className="px-6 pt-4">
                    <Tabs value={selectedTab} onValueChange={setSelectedTab}>
                      <TabsList className="h-8 text-xs">
                        <TabsTrigger value="all" className="text-xs px-3">전체</TabsTrigger>
                        {classesWithStudents.map((c) => (
                          <TabsTrigger key={c.id} value={c.id} className="text-xs px-3">
                            {c.name}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  </div>

                  {/* 전체 선택 */}
                  <div className="flex items-center gap-3 px-6 py-3 border-b">
                    <Checkbox
                      checked={allVisibleChecked}
                      onCheckedChange={toggleAll}
                      disabled={selectableIds.length === 0}
                    />
                    <span className="text-sm text-gray-600">전체 선택</span>
                    <span className="ml-auto text-xs text-gray-400">
                      {visibleStudents.length}명 중 번호 있는 {selectableIds.length}명
                    </span>
                  </div>

                  {/* 학생 목록 */}
                  <div className="divide-y">
                    {visibleStudents.map((s) => {
                      const phone = phoneOf(s)
                      const hasPhone = !!phone
                      return (
                        <div
                          key={s.id}
                          className={`flex items-center gap-3 px-6 py-3 ${hasPhone ? 'cursor-pointer hover:bg-gray-50' : 'opacity-40'}`}
                          onClick={() => hasPhone && toggleOne(s.id)}
                        >
                          <Checkbox
                            checked={selectedIds.has(s.id)}
                            disabled={!hasPhone}
                            onCheckedChange={() => hasPhone && toggleOne(s.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className="text-sm font-medium text-gray-900">{s.name}</span>
                          {phone ? (
                            <span className="flex items-center gap-1 ml-auto text-xs text-gray-400">
                              <Phone className="h-3 w-3" />
                              {phone}
                            </span>
                          ) : (
                            <span className="ml-auto text-xs text-gray-400">번호 없음</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
              <span className="text-sm text-gray-600">
                {selectedIds.size > 0 ? (
                  <span className="font-semibold text-primary">{selectedIds.size}명</span>
                ) : (
                  <span className="text-gray-400">선택된 학생 없음</span>
                )}
                {selectedIds.size > 0 && ' 선택됨'}
              </span>
              <Button
                onClick={() => setStep('compose')}
                disabled={selectedIds.size === 0}
                size="sm"
              >
                다음
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </>
        )}

        {/* Step 2: 메시지 작성 */}
        {step === 'compose' && (
          <>
            <div className="flex-1 overflow-y-auto max-h-[60vh] px-6 py-4 space-y-4">
              {/* 선택된 학생 칩 */}
              <div>
                <p className="text-xs text-gray-400 mb-2">받는 사람 ({selectedStudents.length}명)</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedStudents.map((s) => (
                    <span
                      key={s.id}
                      className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                    >
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>

              {/* 메시지 입력 */}
              <div>
                <p className="text-xs text-gray-400 mb-2">메시지</p>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="보낼 메시지를 입력하세요"
                  rows={8}
                  className="resize-none text-sm"
                  autoFocus
                />
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    {message.length > 90 && (
                      <span className="text-amber-500">장문(LMS) — 건당 25.2원</span>
                    )}
                    {message.length <= 90 && message.length > 0 && (
                      <span className="text-gray-400">단문(SMS) — 건당 8.4원</span>
                    )}
                  </span>
                  <span className={`text-xs ${message.length > 90 ? 'text-amber-500' : 'text-gray-400'}`}>
                    {message.length}자
                  </span>
                </div>
              </div>

              {/* 예상 비용 */}
              {message.length > 0 && (
                <div className="rounded-xl bg-gray-50 px-4 py-3">
                  <p className="text-xs text-gray-500">
                    예상 발송 비용:{' '}
                    <span className="font-semibold text-gray-800">
                      {(selectedStudents.length * (message.length > 90 ? 25.2 : 8.4)).toFixed(0)}원
                    </span>
                    <span className="text-gray-400"> ({selectedStudents.length}명)</span>
                  </p>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setStep('select')}>
                <ChevronLeft className="mr-1 h-4 w-4" />
                이전
              </Button>
              <Button
                onClick={send}
                disabled={!message.trim() || sending}
                size="sm"
              >
                {sending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {selectedStudents.length}명에게 발송 중...
                  </>
                ) : (
                  <>
                    <Megaphone className="mr-2 h-4 w-4" />
                    {selectedStudents.length}명에게 발송
                  </>
                )}
              </Button>
            </div>
          </>
        )}

        {/* Step 3: 발송 결과 */}
        {step === 'result' && (
          <>
            <div className="flex-1 overflow-y-auto max-h-[60vh]">
              {/* 요약 */}
              <div className="px-6 py-5 border-b">
                <div className="flex items-center gap-4">
                  {successCount > 0 && (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                      <span className="text-sm font-semibold text-green-600">{successCount}명 성공</span>
                    </div>
                  )}
                  {failCount > 0 && (
                    <div className="flex items-center gap-2">
                      <XCircle className="h-5 w-5 text-red-400" />
                      <span className="text-sm font-semibold text-red-500">{failCount}명 실패</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 결과 목록 */}
              <div className="divide-y">
                {results.map((r) => (
                  <div key={r.studentId} className="flex items-center gap-3 px-6 py-3">
                    {r.success ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                    )}
                    <span className="text-sm font-medium text-gray-900">{r.studentName}</span>
                    <span className="text-xs text-gray-400">{r.phone}</span>
                    {!r.success && (
                      <span className="ml-auto text-xs text-red-400">{r.error}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="px-6 py-4 border-t bg-gray-50 flex justify-end">
              <Button onClick={() => setOpen(false)} size="sm">
                확인
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
