'use client'

import { use, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ExamSetupForm } from '@/components/exam/exam-setup-form'
import { useWeek, useUpdateWeek } from '@/hooks/use-weeks'

interface WeekFormValues {
  start_date: string
  vocab_total: number
  homework_total: number
}

export default function WeekSetupPage({ params }: { params: Promise<{ classId: string; weekId: string }> }) {
  const { classId, weekId } = use(params)
  const { data: week, isLoading } = useWeek(weekId)
  const updateWeek = useUpdateWeek(weekId)

  const { register, handleSubmit, reset } = useForm<WeekFormValues>()

  useEffect(() => {
    if (week) {
      reset({
        start_date: week.start_date ?? '',
        vocab_total: week.vocab_total,
        homework_total: week.homework_total,
      })
    }
  }, [week, reset])

  async function onSubmit(values: WeekFormValues) {
    await updateWeek.mutateAsync({
      start_date: values.start_date,
      vocab_total: Number(values.vocab_total),
      homework_total: Number(values.homework_total),
    })
  }

  if (isLoading) return <div className="h-8 w-48 animate-pulse rounded bg-gray-100" />

  if (!week) return <p className="text-sm text-gray-500">주차 정보를 찾을 수 없습니다</p>

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/dashboard/${classId}`}>
            <ChevronLeft className="h-4 w-4" />
            수업으로 돌아가기
          </Link>
        </Button>
      </div>

      <h1 className="mb-6 text-2xl font-bold text-gray-900">{week.week_number}주차 설정</h1>

      {/* 주차 기본 정보 */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">기본 정보</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="start_date">수업일</Label>
              <Input id="start_date" type="date" className="w-48" {...register('start_date')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vocab_total">단어시험 총 개수</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="vocab_total"
                    type="number"
                    min={0}
                    className="w-24"
                    {...register('vocab_total', { valueAsNumber: true })}
                  />
                  <span className="text-sm text-gray-400">개</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="homework_total">숙제 총 개수</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="homework_total"
                    type="number"
                    min={0}
                    className="w-24"
                    {...register('homework_total', { valueAsNumber: true })}
                  />
                  <span className="text-sm text-gray-400">개</span>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={updateWeek.isPending}>
                {updateWeek.isPending ? '저장 중...' : '저장'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* 시험 문항 설정 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">시험 문항 설정</CardTitle>
        </CardHeader>
        <CardContent>
          <ExamSetupForm weekId={weekId} />
        </CardContent>
      </Card>
    </div>
  )
}
