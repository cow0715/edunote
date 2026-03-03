'use client'

import { use } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GradeGrid } from '@/components/grade/grade-grid'
import { useWeek } from '@/hooks/use-weeks'

export default function GradePage({ params }: { params: Promise<{ classId: string; weekId: string }> }) {
  const { classId, weekId } = use(params)
  const { data: week, isLoading } = useWeek(weekId)

  if (isLoading) return <div className="h-8 w-48 animate-pulse rounded bg-gray-100" />
  if (!week) return <p className="text-sm text-gray-500">주차 정보를 찾을 수 없습니다</p>

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/dashboard/${classId}/weeks/${weekId}`}>
            <ChevronLeft className="h-4 w-4" />
            {week.week_number}주차 설정
          </Link>
        </Button>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{week.week_number}주차 채점</h1>
        {week.start_date && (
          <p className="mt-1 text-sm text-gray-400">
            {new Date(week.start_date).toLocaleDateString('ko-KR')}
          </p>
        )}
      </div>

      <GradeGrid
        weekId={weekId}
        vocabTotal={week.vocab_total}
        homeworkTotal={week.homework_total}
      />
    </div>
  )
}
