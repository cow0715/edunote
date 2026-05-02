'use client'

import { useState, useMemo } from 'react'
import { MessageSquare, Search, BookOpen, ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useInfiniteMessageLogs, MessageLog } from '@/hooks/use-message-logs'
import { BroadcastDialog } from '@/components/messages/broadcast-dialog'
import { SmsSheet } from '@/components/grade/sms-sheet'
import { useQuery } from '@tanstack/react-query'

type TodayWeek = {
  id: string
  week_number: number
  display_label?: string
  start_date: string
  class_id: string
  class: { id: string; name: string; teacher_id: string }
}

function formatRelative(dateStr: string) {
  const now = new Date()
  const d = new Date(dateStr)
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHour = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)

  if (diffMin < 60) return `${diffMin}분 전`
  if (diffHour < 24) return `${diffHour}시간 전`
  if (diffDay === 1) return '어제'
  if (diffDay < 7) return `${diffDay}일 전`
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
}

function getDateGroupKey(dateStr: string) {
  const now = new Date()
  const d = new Date(dateStr)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart.getTime() - 86400000)
  const weekStart = new Date(todayStart.getTime() - todayStart.getDay() * 86400000)
  const lastWeekStart = new Date(weekStart.getTime() - 7 * 86400000)
  const itemDate = new Date(d.getFullYear(), d.getMonth(), d.getDate())

  if (itemDate >= todayStart) return '오늘'
  if (itemDate >= yesterdayStart) return '어제'
  if (itemDate >= weekStart) return '이번 주'
  if (itemDate >= lastWeekStart) return '지난 주'
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' })
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
        <SmsSheet key={w.id} weekId={w.id} weekNumber={w.week_number} weekLabel={w.display_label}>
          <div className="flex items-center gap-3 rounded-xl bg-white border border-gray-100 shadow-[0px_4px_16px_rgba(0,75,198,0.06)] px-4 py-3 cursor-pointer hover:border-blue-200 hover:shadow-[0px_4px_16px_rgba(0,75,198,0.12)] transition-all">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50">
              <BookOpen className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{w.class.name}</p>
              <p className="text-xs text-gray-400">{w.display_label ?? `${w.week_number}주차`}</p>
            </div>
          </div>
        </SmsSheet>
      ))}
    </div>
  )
}

function MessageItem({ log }: { log: MessageLog }) {
  return (
    <div className="rounded-xl border bg-white px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {log.student?.name[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="font-medium text-gray-900 text-sm">{log.student?.name}</span>
            {log.week ? (
              <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {log.week.class?.name} {log.week.display_label ?? `${log.week.week_number}주차`}
              </span>
            ) : (
              <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">
                공지
              </span>
            )}
            <span className="text-xs text-gray-400 ml-auto">{formatRelative(log.sent_at)}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-gray-600 leading-relaxed">{log.message}</p>
        </div>
      </div>
    </div>
  )
}

export default function MessagesPage() {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteMessageLogs()
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('')

  const allLogs = data?.pages.flatMap((p) => p.logs) ?? []

  const classNames = useMemo(() => {
    const names = new Set<string>()
    allLogs.forEach((log) => {
      if (log.week?.class?.name) names.add(log.week.class.name)
    })
    return Array.from(names).sort()
  }, [allLogs])

  const filtered = allLogs.filter((log) => {
    if (search) {
      const s = search.toLowerCase()
      if (
        !log.student?.name.toLowerCase().includes(s) &&
        !log.week?.class?.name.toLowerCase().includes(s) &&
        !log.message.toLowerCase().includes(s)
      ) return false
    }
    if (classFilter && log.week?.class?.name !== classFilter) return false
    return true
  })

  const grouped = useMemo(() => {
    const keyOrder: string[] = []
    const groupMap = new Map<string, MessageLog[]>()
    for (const log of filtered) {
      const key = getDateGroupKey(log.sent_at)
      if (!groupMap.has(key)) {
        groupMap.set(key, [])
        keyOrder.push(key)
      }
      groupMap.get(key)!.push(log)
    }
    return keyOrder.map((key) => ({ key, logs: groupMap.get(key)! }))
  }, [filtered])

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

      {/* 검색 + 필터 */}
      <div className="mb-6 flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="학생명, 수업명, 내용 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {classNames.length > 0 && (
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="rounded-lg border border-input bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">전체 반</option>
            {classNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-400">
          <MessageSquare className="h-10 w-10 text-gray-200" />
          <p className="text-sm">전송 완료된 메시지가 없습니다</p>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ key, logs }) => (
            <div key={key}>
              <p className="mb-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">{key}</p>
              <div className="space-y-2">
                {logs.map((log) => <MessageItem key={log.id} log={log} />)}
              </div>
            </div>
          ))}

          {hasNextPage && (
            <div className="flex justify-center pt-2 pb-4">
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="gap-2"
              >
                <ChevronDown className="h-4 w-4" />
                {isFetchingNextPage ? '불러오는 중...' : '더 보기'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
