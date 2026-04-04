'use client'

import { useState, useMemo } from 'react'
import { Megaphone, CheckCircle2, XCircle, Loader2, ChevronRight, ChevronLeft, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useClasses } from '@/hooks/use-classes'
import { useQueryClient } from '@tanstack/react-query'
import { Student } from '@/lib/types'
import { toast } from 'sonner'

type ClassWithStudents = { id: string; name: string; students: Student[] }
type SendResult = { studentId: string; studentName: string; recipientLabel: string; phone: string; message: string; success: boolean; error?: string }
type Step = 'select' | 'compose' | 'result'
type RecipientType = 'mother' | 'father' | 'student'

type Recipient = { key: string; studentId: string; type: RecipientType; label: '어머니' | '아버지' | '학생'; phone: string }

const TYPE_LABEL: Record<RecipientType, '어머니' | '아버지' | '학생'> = {
  mother: '어머니', father: '아버지', student: '학생',
}

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

function getRecipients(s: Student): Recipient[] {
  const list: Recipient[] = []
  if (s.mother_phone) list.push({ key: `${s.id}:mother`, studentId: s.id, type: 'mother', label: '어머니', phone: s.mother_phone })
  if (s.father_phone) list.push({ key: `${s.id}:father`, studentId: s.id, type: 'father', label: '아버지', phone: s.father_phone })
  if (s.phone)        list.push({ key: `${s.id}:student`, studentId: s.id, type: 'student', label: '학생',   phone: s.phone })
  return list
}

export function BroadcastDialog() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('select')
  const [classFilter, setClassFilter] = useState('all')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState<SendResult[]>([])
  const [classesWithStudents, setClassesWithStudents] = useState<ClassWithStudents[]>([])
  const [loadingStudents, setLoadingStudents] = useState(false)
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleDate, setScheduleDate] = useState(() => getNearestSchedule().date)
  const [scheduleTime, setScheduleTime] = useState(() => getNearestSchedule().time)

  const { data: classes = [] } = useClasses()
  const qc = useQueryClient()

  async function handleOpen(v: boolean) {
    setOpen(v)
    if (v) { reset(); await loadStudents() }
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
    setStep('select'); setClassFilter('all')
    setSelectedKeys(new Set()); setMessage(''); setResults([])
    const ns = getNearestSchedule()
    setScheduleEnabled(false); setScheduleDate(ns.date); setScheduleTime(ns.time)
  }

  // 전체 학생 (중복 제거)
  const allStudents = useMemo(() => {
    const map = new Map<string, Student>()
    classesWithStudents.forEach((c) => c.students.forEach((s) => map.set(s.id, s)))
    return Array.from(map.values())
  }, [classesWithStudents])

  // 필터된 학생 (목록 표시용만)
  const visibleStudents = useMemo(() => {
    if (classFilter === 'all') return allStudents
    return classesWithStudents.find((c) => c.id === classFilter)?.students ?? []
  }, [classFilter, allStudents, classesWithStudents])

  // 전체 학생 수신자 (선택 결과 집계용)
  const allRecipients = useMemo(() => allStudents.flatMap(getRecipients), [allStudents])

  // 현재 필터된 수신자 (빠른 선택 버튼 기준)
  const visibleRecipients2 = useMemo(() => visibleStudents.flatMap(getRecipients), [visibleStudents])

  // 타입별 수신자 수 (현재 필터 기준)
  const typeCount = useMemo(() => {
    const counts: Record<RecipientType, number> = { mother: 0, father: 0, student: 0 }
    visibleRecipients2.forEach((r) => counts[r.type]++)
    return counts
  }, [visibleRecipients2])

  // 타입별 선택 상태 (현재 필터 기준)
  function typeCheckState(type: RecipientType): boolean | 'indeterminate' {
    const typeRecs = visibleRecipients2.filter((r) => r.type === type)
    if (typeRecs.length === 0) return false
    const selected = typeRecs.filter((r) => selectedKeys.has(r.key))
    if (selected.length === 0) return false
    if (selected.length === typeRecs.length) return true
    return 'indeterminate'
  }

  function toggleType(type: RecipientType) {
    const typeRecs = visibleRecipients2.filter((r) => r.type === type)
    const allChecked = typeRecs.every((r) => selectedKeys.has(r.key))
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (allChecked) typeRecs.forEach((r) => next.delete(r.key))
      else typeRecs.forEach((r) => next.add(r.key))
      return next
    })
  }

  // 보이는 학생 전체 선택 상태
  const allVisibleChecked = visibleRecipients2.length > 0 && visibleRecipients2.every((r) => selectedKeys.has(r.key))
  const someVisibleChecked = visibleRecipients2.some((r) => selectedKeys.has(r.key))

  function toggleAllVisible() {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (allVisibleChecked) visibleRecipients2.forEach((r) => next.delete(r.key))
      else visibleRecipients2.forEach((r) => next.add(r.key))
      return next
    })
  }

  function toggleStudent(s: Student) {
    const recs = getRecipients(s)
    const allChecked = recs.length > 0 && recs.every((r) => selectedKeys.has(r.key))
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (allChecked) recs.forEach((r) => next.delete(r.key))
      else recs.forEach((r) => next.add(r.key))
      return next
    })
  }

  function toggleRecipient(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectedRecipients = useMemo(
    () => allRecipients.filter((r) => selectedKeys.has(r.key)),
    [selectedKeys, allRecipients]
  )

  const selectedByStudent = useMemo(() => {
    const map = new Map<string, { name: string; labels: string[] }>()
    for (const r of selectedRecipients) {
      const s = allStudents.find((s) => s.id === r.studentId)
      if (!map.has(r.studentId)) map.set(r.studentId, { name: s?.name ?? '', labels: [] })
      map.get(r.studentId)!.labels.push(r.label)
    }
    return Array.from(map.values())
  }, [selectedRecipients, allStudents])

  function buildScheduledDate() {
    if (!scheduleEnabled || !scheduleDate || !scheduleTime) return undefined
    return `${scheduleDate}T${scheduleTime}:00+09:00`
  }

  async function send() {
    setSending(true)
    try {
      const targets = selectedRecipients.map((r) => {
        const s = allStudents.find((s) => s.id === r.studentId)!
        return { studentId: r.studentId, studentName: s.name, recipientLabel: r.label, phone: r.phone, message }
      })
      const scheduledDate = buildScheduledDate()
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets, scheduledDate }),
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
        <Button><Megaphone className="mr-2 h-4 w-4" />공지 발송</Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="text-base font-semibold">
            {step === 'select' && '받는 사람 선택'}
            {step === 'compose' && '메시지 작성'}
            {step === 'result' && '발송 결과'}
          </DialogTitle>
        </DialogHeader>

        {/* ── Step 1: 받는 사람 선택 ── */}
        {step === 'select' && (
          <>
            {/* 고정 필터 영역 */}
            <div className="px-6 pt-4 pb-3 space-y-3 border-b bg-white">
              {/* 반 셀렉트 */}
              <Select value={classFilter} onValueChange={setClassFilter}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="반 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 반</SelectItem>
                  {classesWithStudents.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* 빠른 선택: 어머니/아버지/학생 전체 */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400 mr-1 shrink-0">전체 선택</span>
                {(['mother', 'father', 'student'] as RecipientType[]).map((type) => {
                  const state = typeCheckState(type)
                  const count = typeCount[type]
                  if (count === 0) return null
                  return (
                    <button
                      key={type}
                      onClick={() => toggleType(type)}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        state === true
                          ? 'border-primary bg-primary/10 text-primary'
                          : state === 'indeterminate'
                          ? 'border-primary/50 bg-primary/5 text-primary/70'
                          : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {/* button 중첩 방지: Checkbox 대신 시각적 표시 */}
                      <span className={`flex h-3 w-3 items-center justify-center rounded-sm border ${
                        state === true ? 'border-primary bg-primary' : state === 'indeterminate' ? 'border-primary/50 bg-primary/10' : 'border-gray-300'
                      }`}>
                        {state === true && <span className="block h-1.5 w-1.5 rounded-sm bg-white" />}
                        {state === 'indeterminate' && <span className="block h-px w-2 bg-primary/70" />}
                      </span>
                      {TYPE_LABEL[type]}
                      <span className={`${state ? 'text-primary/60' : 'text-gray-400'}`}>{count}</span>
                    </button>
                  )
                })}
                {selectedKeys.size > 0 && (
                  <button
                    onClick={() => setSelectedKeys(new Set())}
                    className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-3 w-3" />초기화
                  </button>
                )}
              </div>
            </div>

            {/* 학생 목록 */}
            <div className="overflow-y-auto max-h-[50vh]">
              {loadingStudents ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
                </div>
              ) : (
                <>
                  {/* 목록 전체 선택 (현재 필터 기준) */}
                  <div className="flex items-center gap-3 px-6 py-2.5 border-b bg-gray-50">
                    <Checkbox
                      checked={allVisibleChecked ? true : someVisibleChecked ? 'indeterminate' : false}
                      onCheckedChange={toggleAllVisible}
                      disabled={visibleRecipients2.length === 0}
                    />
                    <span className="text-xs text-gray-500">
                      {classFilter === 'all' ? '전체' : classesWithStudents.find(c => c.id === classFilter)?.name} 전체 선택
                    </span>
                    <span className="ml-auto text-xs font-semibold text-primary">
                      {selectedKeys.size}건 선택
                    </span>
                  </div>

                  <div className="divide-y">
                    {visibleStudents.map((s) => {
                      const recs = getRecipients(s)
                      const allChecked = recs.length > 0 && recs.every((r) => selectedKeys.has(r.key))
                      const someChecked = recs.some((r) => selectedKeys.has(r.key))
                      return (
                        <div key={s.id} className="px-6 py-3">
                          <div
                            className="flex items-center gap-3 cursor-pointer mb-2"
                            onClick={() => recs.length > 0 && toggleStudent(s)}
                          >
                            <Checkbox
                              checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                              disabled={recs.length === 0}
                              onCheckedChange={() => recs.length > 0 && toggleStudent(s)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span className="text-sm font-semibold text-gray-900">{s.name}</span>
                            {recs.length === 0 && <span className="ml-auto text-xs text-gray-400">번호 없음</span>}
                          </div>
                          {recs.length > 0 && (
                            <div className="ml-7 flex flex-wrap gap-x-4 gap-y-1.5">
                              {recs.map((r) => (
                                <label key={r.key} className="flex items-center gap-1.5 cursor-pointer">
                                  <Checkbox
                                    checked={selectedKeys.has(r.key)}
                                    onCheckedChange={() => toggleRecipient(r.key)}
                                  />
                                  <span className="text-xs font-medium text-gray-700">{r.label}</span>
                                  <span className="text-xs text-gray-400">{r.phone}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
              <span className="text-sm">
                {selectedKeys.size > 0
                  ? <><span className="font-semibold text-primary">{selectedKeys.size}건</span><span className="text-gray-500"> 선택됨</span></>
                  : <span className="text-gray-400">선택된 수신자 없음</span>}
              </span>
              <Button onClick={() => setStep('compose')} disabled={selectedKeys.size === 0} size="sm">
                다음 <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </>
        )}

        {/* ── Step 2: 메시지 작성 ── */}
        {step === 'compose' && (
          <>
            <div className="overflow-y-auto max-h-[60vh] px-6 py-4 space-y-4">
              <div>
                <p className="text-xs text-gray-400 mb-2">받는 사람 ({selectedRecipients.length}건)</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedByStudent.map((g, i) => (
                    <span key={i} className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                      {g.name}
                      {g.labels.length < 3 && (
                        <span className="ml-1 text-primary/60">({g.labels.join('·')})</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>

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
                  <span className="text-xs">
                    {message.length > 90
                      ? <span className="text-amber-500">장문(LMS) — 건당 25.2원</span>
                      : message.length > 0
                      ? <span className="text-gray-400">단문(SMS) — 건당 8.4원</span>
                      : null}
                  </span>
                  <span className={`text-xs ${message.length > 90 ? 'text-amber-500' : 'text-gray-400'}`}>
                    {message.length}자
                  </span>
                </div>
              </div>

              {message.length > 0 && (
                <div className="rounded-xl bg-gray-50 px-4 py-3">
                  <p className="text-xs text-gray-500">
                    예상 발송 비용:{' '}
                    <span className="font-semibold text-gray-800">
                      {(selectedRecipients.length * (message.length > 90 ? 25.2 : 8.4)).toFixed(0)}원
                    </span>
                    <span className="text-gray-400"> ({selectedRecipients.length}건)</span>
                  </p>
                </div>
              )}

              {/* 예약 발송 */}
              <div className="rounded-xl border px-4 py-3 space-y-2.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={scheduleEnabled}
                    onCheckedChange={(v) => setScheduleEnabled(!!v)}
                  />
                  <span className="text-sm font-medium text-gray-700">예약 발송</span>
                </label>
                {scheduleEnabled && (
                  <div className="flex gap-2 ml-6">
                    <input
                      type="date"
                      value={scheduleDate}
                      min={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      className="flex-1 rounded-md border border-input bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <select
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="flex-1 rounded-md border border-input bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setStep('select')}>
                <ChevronLeft className="mr-1 h-4 w-4" />이전
              </Button>
              <Button
                onClick={send}
                disabled={!message.trim() || sending || (scheduleEnabled && (!scheduleDate || !scheduleTime))}
                size="sm"
              >
                {sending
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{selectedRecipients.length}건 처리 중...</>
                  : scheduleEnabled
                  ? <><Megaphone className="mr-2 h-4 w-4" />{selectedRecipients.length}건 예약</>
                  : <><Megaphone className="mr-2 h-4 w-4" />{selectedRecipients.length}건 발송</>}
              </Button>
            </div>
          </>
        )}

        {/* ── Step 3: 발송 결과 ── */}
        {step === 'result' && (
          <>
            <div className="overflow-y-auto max-h-[60vh]">
              <div className="px-6 py-5 border-b flex items-center gap-4">
                {successCount > 0 && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span className="text-sm font-semibold text-green-600">{successCount}건 성공</span>
                  </div>
                )}
                {failCount > 0 && (
                  <div className="flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-red-400" />
                    <span className="text-sm font-semibold text-red-500">{failCount}건 실패</span>
                  </div>
                )}
              </div>
              <div className="divide-y">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 px-6 py-3">
                    {r.success
                      ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                      : <XCircle className="h-4 w-4 shrink-0 text-red-400" />}
                    <span className="text-sm font-medium text-gray-900">{r.studentName}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{r.recipientLabel}</span>
                    <span className="text-xs text-gray-400">{r.phone}</span>
                    {!r.success && <span className="ml-auto text-xs text-red-400">{r.error}</span>}
                  </div>
                ))}
              </div>
            </div>
            <div className="px-6 py-4 border-t bg-gray-50 flex justify-end">
              <Button onClick={() => setOpen(false)} size="sm">확인</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
