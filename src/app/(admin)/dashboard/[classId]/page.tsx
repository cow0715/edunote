'use client'

import { use } from 'react'
import Link from 'next/link'
import { ChevronLeft, BookOpen } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Class } from '@/lib/types'

async function fetchClass(id: string): Promise<Class> {
  const res = await fetch(`/api/classes/${id}`)
  if (!res.ok) throw new Error('수업 정보를 불러올 수 없습니다')
  return res.json()
}

export default function ClassDetailPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = use(params)
  const { data: cls, isLoading } = useQuery({
    queryKey: ['class', classId],
    queryFn: () => fetchClass(classId),
  })

  if (isLoading) {
    return <div className="h-8 w-48 rounded bg-gray-100 animate-pulse" />
  }

  if (!cls) {
    return <p className="text-sm text-gray-500">수업을 찾을 수 없습니다</p>
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard">
            <ChevronLeft className="h-4 w-4" />
            수업 목록
          </Link>
        </Button>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{cls.name}</h1>
          {cls.description && <p className="mt-1 text-sm text-gray-500">{cls.description}</p>}
          <p className="mt-1 text-xs text-gray-400">
            {new Date(cls.start_date).toLocaleDateString('ko-KR')} ~{' '}
            {new Date(cls.end_date).toLocaleDateString('ko-KR')}
          </p>
        </div>
      </div>

      <div className="mt-10 flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
        <BookOpen className="mb-3 h-10 w-10 text-gray-300" />
        <p className="text-sm text-gray-500">Day 3에서 학생 및 주차별 내용이 추가됩니다</p>
      </div>
    </div>
  )
}
