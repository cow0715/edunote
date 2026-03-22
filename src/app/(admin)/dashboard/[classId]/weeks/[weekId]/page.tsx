'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Settings } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { WeekResultTable } from '@/components/grade/week-result-table'
import { GradeGrid } from '@/components/grade/grade-grid'
import { SmsSheet } from '@/components/grade/sms-sheet'
import { AttendanceManager } from '@/components/attendance/attendance-manager'
import { AnswerSheetUploader } from '@/components/grade/answer-sheet-uploader'
import { QuestionTypeEditor } from '@/components/grade/question-type-editor'
import { useWeek, useUpdateWeek } from '@/hooks/use-weeks'
import { useClass } from '@/hooks/use-classes'
import { useClassStudents } from '@/hooks/use-students'
import { ClassStudent } from '@/lib/types'
import { generateSessionDates } from '@/lib/schedule'

interface WeekFormValues {
  start_date: string
  vocab_total: number
  homework_total: number
}

export default function WeekDetailPage({ params }: { params: Promise<{ classId: string; weekId: string }> }) {
  const { classId, weekId } = use(params)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pageTab, setPageTab] = useState<'overview' | 'grade'>('overview')

  const { data: week, isLoading } = useWeek(weekId)
  const { data: cls } = useClass(classId)
  const { data: classStudents = [] } = useClassStudents(classId)
  const updateWeek = useUpdateWeek(weekId)

  const [activeTab, setActiveTab] = useState('basic')
  const { register, handleSubmit, reset, formState: { isDirty } } = useForm<WeekFormValues>()

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
      reading_total: week?.reading_total ?? 0,
      homework_total: Number(values.homework_total),
    })
    setSettingsOpen(false)
  }

  async function onSubmitWithoutClose(values: WeekFormValues) {
    await updateWeek.mutateAsync({
      start_date: values.start_date,
      vocab_total: Number(values.vocab_total),
      reading_total: week?.reading_total ?? 0,
      homework_total: Number(values.homework_total),
    })
  }

  function handleTabChange(value: string) {
    if (activeTab === 'basic' && value !== 'basic' && isDirty) {
      handleSubmit(onSubmitWithoutClose)()
    }
    setActiveTab(value)
  }

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
        <span className="text-gray-900 font-medium">{week?.week_number}주차</span>
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
          <SmsSheet weekId={weekId} weekNumber={week.week_number} />
        </div>
      </div>

      {/* 페이지 탭: 현황 | 채점 */}
      <Tabs value={pageTab} onValueChange={(v) => setPageTab(v as 'overview' | 'grade')}>
        <TabsList className="mb-5">
          <TabsTrigger value="overview">현황</TabsTrigger>
          <TabsTrigger value="grade">채점</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <WeekResultTable
            weekId={weekId}
            classId={classId}
            startDate={week.start_date}
            vocabTotal={week.vocab_total}
            readingTotal={week.reading_total}
            homeworkTotal={week.homework_total}
          />
        </TabsContent>

        <TabsContent value="grade">
          <GradeGrid
            weekId={weekId}
            vocabTotal={week.vocab_total}
            readingTotal={week.reading_total}
            homeworkTotal={week.homework_total}
            onSaved={() => setPageTab('overview')}
          />
        </TabsContent>
      </Tabs>

      {/* 설정 모달 */}
      <Dialog open={settingsOpen} onOpenChange={(v) => { setSettingsOpen(v); if (!v) setActiveTab('basic') }}>
        <DialogContent className="max-w-[95vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{week.week_number}주차 설정</DialogTitle>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={handleTabChange} className="pt-2">
            <TabsList className="w-full">
              <TabsTrigger value="basic" className="flex-1">기본 정보</TabsTrigger>
              <TabsTrigger value="answer-sheet" className="flex-1">해설지</TabsTrigger>
              <TabsTrigger value="question-types" className="flex-1">문항 유형</TabsTrigger>
              <TabsTrigger value="attendance" className="flex-1">출결</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4 pt-4">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="start_date">수업일</Label>
                  <Input id="start_date" type="date" className="w-48" {...register('start_date')} />
                </div>
                <div className="grid grid-cols-3 gap-4">
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
                    <Label>진단평가 총 개수</Label>
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-24 items-center justify-center rounded-md border bg-gray-50 text-sm text-gray-500">
                        {week.reading_total}
                      </div>
                      <span className="text-sm text-gray-400">개 (해설지 자동)</span>
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

            <TabsContent value="answer-sheet" className="pt-4">
              <AnswerSheetUploader weekId={weekId} savedFilePath={week?.answer_sheet_path} />
            </TabsContent>

            <TabsContent value="question-types" className="pt-4">
              <QuestionTypeEditor weekId={weekId} />
            </TabsContent>

            <TabsContent value="attendance" className="pt-4">
              <AttendanceManager
                classId={classId}
                classStudents={classStudents as ClassStudent[]}
                defaultDate={week.start_date ?? undefined}
                scheduledDates={cls && (cls.schedule_days?.length ?? 0) > 0
                  ? generateSessionDates(cls.start_date, cls.end_date, cls.schedule_days)
                  : undefined}
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  )
}
