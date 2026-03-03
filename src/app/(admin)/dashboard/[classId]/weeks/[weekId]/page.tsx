'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ClipboardList, Settings } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { WeekResultTable } from '@/components/grade/week-result-table'
import { ExamSetupForm } from '@/components/exam/exam-setup-form'
import { useWeek, useUpdateWeek } from '@/hooks/use-weeks'

interface WeekFormValues {
  start_date: string
  vocab_total: number
  homework_total: number
}

export default function WeekDetailPage({ params }: { params: Promise<{ classId: string; weekId: string }> }) {
  const { classId, weekId } = use(params)
  const [settingsOpen, setSettingsOpen] = useState(false)

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
    setSettingsOpen(false)
  }

  if (isLoading) return <div className="h-8 w-48 animate-pulse rounded bg-gray-100" />
  if (!week) return <p className="text-sm text-gray-500">주차 정보를 찾을 수 없습니다</p>

  return (
    <div>
      {/* 뒤로가기 */}
      <div className="mb-6 flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/dashboard/${classId}`}>
            <ChevronLeft className="h-4 w-4" />
            수업으로 돌아가기
          </Link>
        </Button>
      </div>

      {/* 헤더 */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{week.week_number}주차</h1>
          <div className="mt-1 flex gap-3 text-xs text-gray-400">
            {week.start_date && <span>{new Date(week.start_date).toLocaleDateString('ko-KR')}</span>}
            {week.vocab_total > 0 && <span>단어 {week.vocab_total}개</span>}
            {week.homework_total > 0 && <span>숙제 {week.homework_total}개</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            <Settings className="mr-2 h-4 w-4" />
            설정
          </Button>
          <Button asChild>
            <Link href={`/dashboard/${classId}/weeks/${weekId}/grade`}>
              <ClipboardList className="mr-2 h-4 w-4" />
              채점하기
            </Link>
          </Button>
        </div>
      </div>

      {/* 메인: 결과 현황 */}
      <WeekResultTable
        weekId={weekId}
        vocabTotal={week.vocab_total}
        homeworkTotal={week.homework_total}
      />

      {/* 설정 모달 */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{week.week_number}주차 설정</DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="basic" className="pt-2">
            <TabsList className="w-full">
              <TabsTrigger value="basic" className="flex-1">기본 정보</TabsTrigger>
              <TabsTrigger value="exam" className="flex-1">시험 문항</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4 pt-4">
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
                <div className="flex justify-end pt-2">
                  <Button type="submit" disabled={updateWeek.isPending}>
                    {updateWeek.isPending ? '저장 중...' : '저장'}
                  </Button>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="exam" className="pt-4">
              <ExamSetupForm weekId={weekId} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  )
}
