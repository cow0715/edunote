'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Printer, Settings, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useGradeData } from '@/hooks/use-grade'
import { GradeGrid } from '@/components/grade/grade-grid'
import { SmsSheet } from '@/components/grade/sms-sheet'
import { SettingsEditContext, type SettingsEditState } from '@/components/grade/settings-edit-state'
import { UnsavedChangesGuard } from '@/components/grade/unsaved-changes-guard'
import { AttendanceManager } from '@/components/attendance/attendance-manager'
import { AnswerSheetUploader } from '@/components/grade/answer-sheet-uploader'
import { QuestionTypeEditor } from '@/components/grade/question-type-editor'
import { VocabWordSetup } from '@/components/grade/vocab-word-setup'
import { useWeek, useWeeks, useUpdateWeek } from '@/hooks/use-weeks'
import { useClass, useClassPeriods } from '@/hooks/use-classes'
import { useClassStudents } from '@/hooks/use-students'
import { ClassStudent } from '@/lib/types'
import { buildWeekDisplayMap } from '@/lib/class-periods'
import { generateSessionDates } from '@/lib/schedule'

interface WeekFormValues {
  start_date: string
  vocab_total: number
  homework_total: number
}

export default function WeekDetailPage({ params }: { params: Promise<{ classId: string; weekId: string }> }) {
  const { classId, weekId } = use(params)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { data: week, isLoading, isError, refetch } = useWeek(weekId)
  const { data: weeks = [] } = useWeeks(classId)
  const { data: cls } = useClass(classId)
  const { data: periods = [] } = useClassPeriods(classId)
  const { data: classStudents = [] } = useClassStudents(classId, true)
  const { data: gradeData } = useGradeData(weekId)
  const updateWeek = useUpdateWeek(weekId)

  const [activeTab, setActiveTab] = useState('basic')
  const [panelStates, setPanelStates] = useState<Record<string, SettingsEditState>>({})
  const reportPanel = useCallback((panel: string, state: SettingsEditState) => {
    setPanelStates(previous => previous[panel]?.dirty === state.dirty && previous[panel]?.busy === state.busy ? previous : { ...previous, [panel]: state })
  }, [])
  const childDirty = Object.values(panelStates).some(panel => panel.dirty)
  const childBusy = Object.values(panelStates).some(panel => panel.busy)

  const { register, handleSubmit, reset, formState: { isDirty } } = useForm<WeekFormValues>()

  const seenWeek = useRef<typeof week>(undefined)
  const [basicError, setBasicError] = useState<string | null>(null)
  useEffect(() => {
    if (seenWeek.current === week) return
    seenWeek.current = week
    if (week && !isDirty) {
      reset({
        start_date: week.start_date ?? '',
        vocab_total: week.vocab_total,
        homework_total: week.homework_total,
      })
    }
  }, [week, reset, isDirty])

  async function onSubmit(values: WeekFormValues) {
    setBasicError(null)
    try {
      await updateWeek.mutateAsync({
        start_date: values.start_date,
        vocab_total: week?.vocab_total ?? 0,
        reading_total: week?.reading_total ?? 0,
        homework_total: Number(values.homework_total),
      })
      reset(values)
    } catch (error) { setBasicError(error instanceof Error ? error.message : '기본 정보를 저장하지 못했습니다.') }
  }

  function handleTabChange(value: string) {
    if (!updateWeek.isPending && !childBusy) setActiveTab(value)
    // forceMount keeps each tab's edits intact; only closing discards them.
  }

  function changeSettingsOpen(open: boolean) {
    if (updateWeek.isPending || childBusy) return
    if (!open && (isDirty || childDirty) && !window.confirm('설정에 저장하지 않은 변경이 있습니다. 변경을 버리고 닫을까요?')) return
    if (!open) { reset(); setActiveTab('basic') }
    setSettingsOpen(open)
  }

  if (isLoading) return <div className="h-8 w-48 animate-pulse rounded bg-gray-100" />
  if (isError && !week) return <div role="alert" className="rounded-[20px] bg-card p-6"><p className="text-sm">주차 정보를 불러오지 못했습니다.</p><Button variant="outline" className="mt-3" onClick={() => void refetch()}>다시 시도</Button></div>
  if (!week) return <p className="text-sm text-gray-500">주차 정보를 찾을 수 없습니다</p>

  const weekDisplaySource = weeks.length > 0 ? weeks : [week]
  const weekDisplay = buildWeekDisplayMap(weekDisplaySource, periods).get(week.id)?.displayLabel ?? `${week.week_number}주차`
  const scheduledDates = cls && (cls.schedule_days?.length ?? 0) > 0
    ? (() => {
        const base = generateSessionDates(cls.start_date, cls.end_date, cls.schedule_days)
        if (week.start_date && !base.includes(week.start_date)) {
          return [...base, week.start_date].sort()
        }
        return base
      })()
    : undefined

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
        <span className="text-gray-900 font-medium">{weekDisplay}</span>
      </div>

      {/* 헤더 */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[23px] leading-[1.32] font-bold tracking-[-0.025em] text-foreground">{weekDisplay}</h1>
          <div className="mt-1 flex gap-3 text-xs text-gray-400">
            {week.start_date && <span>{new Date(week.start_date).toLocaleDateString('ko-KR')}</span>}
            {week.vocab_total > 0 && <span>단어 {week.vocab_total}개</span>}
            {week.homework_total > 0 && <span>숙제 {week.homework_total}개</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { reset({ start_date: week.start_date ?? '', vocab_total: week.vocab_total, homework_total: week.homework_total }); setBasicError(null); setSettingsOpen(true) }}>
            <Settings className="mr-2 h-4 w-4" />
            설정
          </Button>
          <SmsSheet weekId={weekId} weekNumber={week.week_number} weekLabel={weekDisplay} />
        </div>
      </div>

      {/* 해설 미생성 복구 칩 — 업로드 중 끊겨 해설이 비어 있을 때만 나타남 */}

      <GradeGrid
        classId={classId}
        attendanceDate={week.start_date}
        key={weekId}
        weekId={weekId}
        vocabTotal={week.vocab_total}
        readingTotal={week.reading_total}
        homeworkTotal={week.homework_total}
        onOpenAttendance={() => { reset({ start_date: week.start_date ?? '', vocab_total: week.vocab_total, homework_total: week.homework_total }); setBasicError(null); setActiveTab('attendance'); setSettingsOpen(true) }}
      />

      {/* 설정 모달 */}
      <UnsavedChangesGuard dirty={settingsOpen && (isDirty || childDirty)} busy={settingsOpen && (updateWeek.isPending || childBusy)} />
      <SettingsEditContext.Provider value={reportPanel}>
      <Dialog open={settingsOpen} onOpenChange={changeSettingsOpen}>
        <DialogContent
          showCloseButton={false}
          className={`flex max-h-[90dvh] max-w-[95vw] flex-col gap-0 overflow-hidden p-0 ${activeTab === 'basic' ? 'h-auto sm:max-w-3xl' : activeTab === 'attendance' ? 'h-[min(640px,90dvh)] sm:max-w-4xl' : 'h-[min(820px,90dvh)] sm:max-w-[98vw] xl:max-w-7xl'}`}
        >
          <DialogHeader className="shrink-0 px-5 pt-4 pb-3 text-left">
            <div className="flex items-center justify-between gap-3"><DialogTitle>{weekDisplay} 설정</DialogTitle><Button variant="ghost" size="icon" aria-label="설정 닫기" disabled={updateWeek.isPending || childBusy} onClick={() => changeSettingsOpen(false)}><X className="size-4" /></Button></div>
            <DialogDescription>{updateWeek.isPending || childBusy ? '처리 중입니다. 완료된 뒤 탭을 옮기거나 닫아 주세요.' : '탭마다 따로 저장합니다. 탭을 옮겨도 입력은 유지됩니다.'}</DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={handleTabChange} className="min-h-0 flex-1 gap-0">
            <div className="shrink-0 overflow-x-auto border-b px-5 pb-3"><TabsList className="w-max min-w-full">
              <TabsTrigger value="basic" className="flex-1">기본 정보{isDirty ? ' · 미저장' : ''}</TabsTrigger>
              <TabsTrigger value="attendance" className="flex-1">출결{panelStates.attendance?.dirty ? ' · 미저장' : ''}</TabsTrigger>
              <TabsTrigger value="answer-sheet" className="flex-1">시험 자료{panelStates.upload?.dirty || panelStates['answer-review']?.dirty ? ' · 미저장' : ''}</TabsTrigger>
              <TabsTrigger value="vocab-words" className="flex-1">단어 시험{panelStates.vocab?.dirty ? ' · 미저장' : ''}</TabsTrigger>
              <TabsTrigger value="question-types" className="flex-1">문항·정답{panelStates.questions?.dirty ? ' · 미저장' : ''}</TabsTrigger>
            </TabsList></div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            <TabsContent value="basic" forceMount className="data-[state=inactive]:hidden mx-auto max-w-4xl space-y-4">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                {basicError && <p role="alert" className="text-sm text-[var(--share-red)]">{basicError} · 입력은 유지됩니다.</p>}
                <div className="space-y-2">
                  <Label htmlFor="start_date">수업일</Label>
                  <Input id="start_date" type="date" className="w-48" {...register('start_date')} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>단어 시험</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex h-9 w-24 items-center justify-center rounded-xl bg-muted text-sm font-semibold text-foreground">
                        {week.vocab_total}
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => handleTabChange('vocab-words')}>단어 시험에서 변경<ChevronRight className="size-3.5" /></Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>진단평가</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex h-9 w-24 items-center justify-center rounded-xl bg-muted text-sm font-semibold text-foreground">
                        {week.reading_total}
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => handleTabChange('question-types')}>문항·정답 확인<ChevronRight className="size-3.5" /></Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="homework_total">숙제 총 개수</Label>
                    <div className="flex flex-wrap items-center gap-2">
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
                <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t bg-background py-3">
                  <p role="status" className="text-xs text-muted-foreground">{isDirty ? '기본 정보 미저장' : '기본 정보 변경 없음'}</p>
                  <Button type="submit" variant="action" disabled={updateWeek.isPending || !isDirty}>
                    {updateWeek.isPending ? '저장 중...' : '기본 정보 저장'}
                  </Button>
                </div>
              </form>

            </TabsContent>
            <TabsContent value="attendance" forceMount className="data-[state=inactive]:hidden mx-auto max-w-4xl">
              <div className="border-t border-gray-100 pt-4">
                <div className="mb-3">
                  <h3 className="text-sm font-bold text-gray-900">출결</h3>
                  <p className="mt-0.5 text-xs text-gray-400">수업일 기준 출석/지각/결석을 함께 관리합니다.</p>
                </div>
                <AttendanceManager
                  recordedStudentIds={(gradeData?.classStudents ?? []).map((student: { student_id: string }) => student.student_id)}
                  classId={classId}
                  classStudents={classStudents as ClassStudent[]}
                  defaultDate={week.start_date ?? undefined}
                  scheduledDates={scheduledDates}
                />
              </div>
            </TabsContent>

            <TabsContent value="answer-sheet" forceMount className="data-[state=inactive]:hidden pt-4 space-y-0">
              <AnswerSheetUploader
                weekId={weekId}
                savedFilePath={week?.answer_sheet_path}
                readingTotal={week?.reading_total}
              />
              <div className="flex justify-end border-t py-3">
                <Button variant="outline" size="sm"
                  type="button"
                  onClick={() => window.open(`/dashboard/${classId}/weeks/${weekId}/answer-sheet/print`, '_blank')}
                >
                  <Printer className="size-4" />답안지 인쇄
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="vocab-words" forceMount className="data-[state=inactive]:hidden pt-4">
              <VocabWordSetup weekId={weekId} />
            </TabsContent>

            <TabsContent value="question-types" forceMount className="data-[state=inactive]:hidden pt-4">
              <QuestionTypeEditor weekId={weekId} />
            </TabsContent>

            </div>
          </Tabs>
        </DialogContent>
      </Dialog>
      </SettingsEditContext.Provider>
    </div>
  )
}
