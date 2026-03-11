'use client'

import { useState } from 'react'
import { MessageSquare, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useMessageLogs, MessageLog } from '@/hooks/use-message-logs'

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
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

  // 학생별로 그룹핑
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">메시지 내역</h1>
        <p className="mt-1 text-sm text-gray-400">전송 완료로 저장한 학부모 문자 이력</p>
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
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-gray-400">
          <MessageSquare className="h-10 w-10 text-gray-200" />
          <p className="text-sm">전송 완료된 메시지가 없습니다</p>
          <p className="text-xs">문자 생성 후 학생별 &apos;전송 완료&apos; 버튼을 눌러주세요</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([, group]) => (
            <div key={group.student?.id} className="rounded-xl border bg-white">
              {/* 학생 헤더 */}
              <div className="flex items-center gap-3 border-b px-5 py-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {group.student?.name[0]}
                </div>
                <span className="font-medium text-gray-900">{group.student?.name}</span>
                <span className="text-xs text-gray-400">{group.logs.length}건</span>
              </div>

              {/* 메시지 목록 */}
              <div className="divide-y">
                {group.logs.map((log) => (
                  <div key={log.id} className="px-5 py-4">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {log.week?.class?.name} {log.week?.week_number}주차
                      </span>
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
