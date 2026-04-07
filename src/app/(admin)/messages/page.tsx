'use client'

import { useState } from 'react'
import { MessageSquare, Search, BookOpen } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useMessageLogs, MessageLog } from '@/hooks/use-message-logs'
import { BroadcastDialog } from '@/components/messages/broadcast-dialog'
import { SmsSheet } from '@/components/grade/sms-sheet'
import { useQuery } from '@tanstack/react-query'

type TodayWeek = {
  id: string
  week_number: number
  start_date: string
  class_id: string
  class: { id: string; name: string; teacher_id: string }
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

function TodayClasses() {
  const { data: weeks = [], isLoading } = useQuery<TodayWeek[]>({
    queryKey: ['weeks-today'],
    queryFn: () => fetch('/api/weeks/today').then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading) return (
    <div className="flex gap-2">
      {[1, 2].map((i) => <div key={i} className="h-16 w-40 animate-pulse rounded-xl bg-gray-100" />)}
    </div>
  )

  if (weeks.length === 0) return (
    <p className="text-sm text-gray-400">오늘 수업이 없습니다</p>
  )

  return (
    <div className="flex flex-wrap gap-2">
      {weeks.map((w) => (
        <SmsSheet key={w.id} weekId={w.id} weekNumber={w.week_number}>
          <div className="flex items-center gap-3 rounded-xl bg-white border border-gray-100 shadow-[0px_4px_16px_rgba(0,75,198,0.06)] px-4 py-3 cursor-pointer hover:border-blue-200 hover:shadow-[0px_4px_16px_rgba(0,75,198,0.12)] transition-all">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50">
              <BookOpen className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{w.class.name}</p>
              <p className="text-xs text-gray-400">{w.week_number}주차</p>
            </div>
          </div>
        </SmsSheet>
      ))}
    </div>
  )
}

export default function MessagesPage() {
  const { data: logs = [], isLoading } = useMessageLogs()
  const [search, setSearch] = useState('')

  const filtered = logs.filter((log) => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      log.student?.name.toLowerCase().includes(s) ||
      log.week?.class?.name.toLowerCase().includes(s) ||
      log.message.toLowerCase().includes(s)
    )
  })

  const grouped = filtered.reduce<Record<string, { student: MessageLog['student']; logs: MessageLog[] }>>(
    (acc, log) => {
      const sid = log.student_id
      if (!acc[sid]) acc[sid] = { student: log.student, logs: [] }
      acc[sid].logs.push(log)
      return acc
    },
    {}
  )

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">메시지</h1>
          <p className="mt-1 text-sm text-gray-400">학부모 문자 발송 및 내역</p>
        </div>
        <BroadcastDialog />
      </div>

      {/* 오늘 수업 */}
      <div className="mb-8">
        <p className="mb-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">오늘 수업</p>
        <TodayClasses />
      </div>

      {/* 검색 */}
      <div className="relative mb-6 max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          placeholder="학생명, 수업명 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-400">
          <MessageSquare className="h-10 w-10 text-gray-200" />
          <p className="text-sm">전송 완료된 메시지가 없습니다</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([, group]) => (
            <div key={group.student?.id} className="rounded-xl border bg-white">
              <div className="flex items-center gap-3 border-b px-5 py-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {group.student?.name[0]}
                </div>
                <span className="font-medium text-gray-900">{group.student?.name}</span>
                <span className="text-xs text-gray-400">{group.logs.length}건</span>
              </div>

              <div className="divide-y">
                {group.logs.map((log) => (
                  <div key={log.id} className="px-5 py-4">
                    <div className="mb-2 flex items-center gap-2">
                      {log.week ? (
                        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          {log.week.class?.name} {log.week.week_number}주차
                        </span>
                      ) : (
                        <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">
                          공지
                        </span>
                      )}
                      <span className="text-xs text-gray-400">{formatDate(log.sent_at)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">{log.message}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
