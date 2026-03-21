'use client'

import { use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { GradeGrid } from '@/components/grade/grade-grid'
import { useWeek } from '@/hooks/use-weeks'
import { useClass } from '@/hooks/use-classes'

export default function GradePage({ params }: { params: Promise<{ classId: string; weekId: string }> }) {
  const { classId, weekId } = use(params)
  const router = useRouter()
  const { data: week, isLoading } = useWeek(weekId)
  const { data: cls } = useClass(classId)

  if (isLoading) return <div className="h-8 w-48 animate-pulse rounded bg-gray-100" />
  if (!week) return <p className="text-sm text-gray-500">주차 정보를 찾을 수 없습니다</p>

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-1 text-sm text-gray-500">
        <Link href="/dashboard" className="hover:text-gray-700 transition-colors">
          수업 목록
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
        <Link href={`/dashboard/${classId}`} className="hover:text-gray-700 transition-colors">
          {cls?.name ?? '수업'}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
        <Link href={`/dashboard/${classId}/weeks/${weekId}`} className="hover:text-gray-700 transition-colors">
          {week.week_number}주차
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
        <span className="text-gray-900 font-medium">채점</span>
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
        readingTotal={week.reading_total}
        homeworkTotal={week.homework_total}
        onSaved={() => router.push(`/dashboard/${classId}/weeks/${weekId}`)}
      />
    </div>
  )
}
