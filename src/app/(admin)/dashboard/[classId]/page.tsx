'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, UserPlus, UserMinus, Users, RefreshCw, ClipboardList, Link as LinkIcon, AlertTriangle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Class, ClassStudent, Student } from '@/lib/types'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useClassStudents, useStudents, useAddClassStudent, useRemoveClassStudent } from '@/hooks/use-students'
import { useWeeks } from '@/hooks/use-weeks'
import { useSyncWeeks } from '@/hooks/use-classes'

const DAY_LABEL: Record<string, string> = {
  mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일',
}

async function fetchClass(id: string): Promise<Class> {
  const res = await fetch(`/api/classes/${id}`)
  if (!res.ok) throw new Error('수업 정보를 불러올 수 없습니다')
  return res.json()
}

export default function ClassDetailPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = use(params)
  const [addOpen, setAddOpen] = useState(false)
  const [addStep, setAddStep] = useState<{ studentId: string; name: string; joinedAt: string } | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{ studentId: string; name: string; leftAt: string } | null>(null)
  const [syncWarning, setSyncWarning] = useState<{ message: string; affected_weeks: number[] } | null>(null)

  const { data: cls, isLoading: classLoading } = useQuery({
    queryKey: ['class', classId],
    queryFn: () => fetchClass(classId),
  })
  const { data: classStudents = [] } = useClassStudents(classId)
  const { data: allStudents = [] } = useStudents()
  const { data: weeks = [] } = useWeeks(classId)
  const addStudent = useAddClassStudent(classId)
  const removeStudent = useRemoveClassStudent(classId)
  const syncWeeks = useSyncWeeks(classId)

  const enrolledIds = new Set((classStudents as ClassStudent[]).map((cs) => cs.student_id))
  const unenrolled = (allStudents as Student[]).filter((s) => !enrolledIds.has(s.id))

  function handleRemoveClick(studentId: string, name: string) {
    setRemoveTarget({ studentId, name, leftAt: new Date().toISOString().slice(0, 10) })
  }

  function confirmRemove() {
    if (!removeTarget) return
    removeStudent.mutate({ studentId: removeTarget.studentId, left_at: removeTarget.leftAt })
    setRemoveTarget(null)
  }

  function confirmAdd() {
    if (!addStep) return
    addStudent.mutate({ student_id: addStep.studentId, joined_at: addStep.joinedAt })
    setAddStep(null)
    setAddOpen(false)
  }

async function handleSync(force = false) {
    const result = await syncWeeks.mutateAsync(force)
    if (result?.warning) {
      setSyncWarning({ message: result.message, affected_weeks: result.affected_weeks })
    } else {
      setSyncWarning(null)
    }
  }

  if (classLoading) return <div className="h-8 w-48 rounded bg-gray-100 animate-pulse" />
  if (!cls) return <p className="text-sm text-gray-500">수업을 찾을 수 없습니다</p>

  const scheduleDays = cls.schedule_days ?? []
  const scheduleLabel = scheduleDays.length > 0
    ? `주 ${scheduleDays.length}회 (${scheduleDays.map((d) => DAY_LABEL[d] ?? d).join('·')})`
    : '요일 미설정'

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

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{cls.name}</h1>
        {cls.description && <p className="mt-1 text-sm text-gray-500">{cls.description}</p>}
        <p className="mt-1 text-xs text-gray-400">
          {new Date(cls.start_date).toLocaleDateString('ko-KR')} ~{' '}
          {new Date(cls.end_date).toLocaleDateString('ko-KR')}
          <span className="ml-2">{scheduleLabel}</span>
        </p>
      </div>

      <Tabs defaultValue="students">
        <TabsList className="mb-4">
          <TabsTrigger value="students">학생 ({classStudents.length})</TabsTrigger>
          <TabsTrigger value="weeks">주차 ({weeks.length})</TabsTrigger>
        </TabsList>

        {/* 학생 탭 */}
        <TabsContent value="students">
          <div className="flex justify-end mb-3">
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              <UserPlus className="mr-1.5 h-4 w-4" />
              학생 추가
            </Button>
          </div>

          {classStudents.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
              <Users className="mb-3 h-8 w-8 text-gray-300" />
              <p className="text-sm text-gray-500">수강 학생이 없어요</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setAddOpen(true)}>
                학생 추가하기
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {(classStudents as ClassStudent[]).map((cs) => (
                <Card key={cs.id} className="group">
                  <CardContent className="flex items-center gap-3 py-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {cs.student?.name[0]}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{cs.student?.name}</p>
                      {cs.student?.grade && (
                        <p className="text-xs text-gray-400">
                          {cs.student.school ? `${cs.student.school} ` : ''}{cs.student.grade}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {cs.student?.share_token && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-blue-400 hover:text-blue-600"
                          onClick={() => window.open(`/share/${cs.student!.share_token}`, '_blank')}
                          title="학부모 공유 페이지 열기"
                        >
                          <LinkIcon className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-600"
                        onClick={() => handleRemoveClick(cs.student_id, cs.student?.name ?? '')}
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* 주차 탭 */}
        <TabsContent value="weeks">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-gray-400">{scheduleLabel}</p>
            {scheduleDays.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleSync(false)}
                disabled={syncWeeks.isPending}
              >
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncWeeks.isPending ? 'animate-spin' : ''}`} />
                주차 재생성
              </Button>
            )}
          </div>

          {/* 경고 다이얼로그 */}
          {syncWarning && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-800">{syncWarning.message}</p>
                  <p className="mt-1 text-xs text-amber-600">
                    영향받는 주차: {syncWarning.affected_weeks.join(', ')}주차
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="destructive" onClick={() => handleSync(true)}>
                      삭제하고 재생성
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setSyncWarning(null)}>
                      취소
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {weeks.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
              <p className="text-sm text-gray-500">아직 주차가 없어요</p>
              {scheduleDays.length === 0 && (
                <p className="mt-1 text-xs text-gray-400">수업 수정에서 요일을 설정하면 자동으로 생성됩니다</p>
              )}
              {scheduleDays.length > 0 && (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => handleSync(false)} disabled={syncWeeks.isPending}>
                  주차 생성하기
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {weeks.map((week) => (
                <Card key={week.id} className="group hover:shadow-sm transition-shadow">
                  <CardContent className="flex items-center gap-4 py-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-gray-600">
                      {week.week_number}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{week.week_number}주차</p>
                      <div className="flex gap-3 mt-0.5 text-xs text-gray-400">
                        {week.start_date && <span>{new Date(week.start_date).toLocaleDateString('ko-KR')}</span>}
                        <span>단어 {week.vocab_total}개</span>
                        <span>숙제 {week.homework_total}개</span>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="h-7 px-3" asChild>
                      <Link href={`/dashboard/${classId}/weeks/${week.id}`}>
                        <ClipboardList className="mr-1.5 h-3.5 w-3.5" />
                        채점/설정
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* 학생 추가 다이얼로그 */}
      <Dialog open={addOpen} onOpenChange={(v) => { setAddOpen(v); if (!v) setAddStep(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{addStep ? `${addStep.name} 입원 날짜` : '학생 추가'}</DialogTitle>
          </DialogHeader>
          {addStep ? (
            <div className="space-y-4 pt-1">
              <div className="space-y-2">
                <Label>입원일</Label>
                <Input
                  type="date"
                  value={addStep.joinedAt}
                  onChange={(e) => setAddStep({ ...addStep, joinedAt: e.target.value })}
                  className="w-full"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAddStep(null)}>이전</Button>
                <Button onClick={confirmAdd} disabled={!addStep.joinedAt || addStudent.isPending}>추가</Button>
              </div>
            </div>
          ) : unenrolled.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500">
              추가할 수 있는 학생이 없어요.
              <br />먼저 학생 관리에서 학생을 등록해주세요.
            </p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {unenrolled.map((s) => (
                <button
                  key={s.id}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-gray-50 transition-colors"
                  onClick={() => setAddStep({ studentId: s.id, name: s.name, joinedAt: new Date().toISOString().slice(0, 10) })}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {s.name[0]}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{s.name}</p>
                    {s.grade && <p className="text-xs text-gray-400">{s.grade}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 퇴원 확인 다이얼로그 */}
      <Dialog open={!!removeTarget} onOpenChange={(v) => { if (!v) setRemoveTarget(null) }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>{removeTarget?.name} 퇴원 처리</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-2">
              <Label>퇴원일</Label>
              <Input
                type="date"
                value={removeTarget?.leftAt ?? ''}
                onChange={(e) => setRemoveTarget((t) => t ? { ...t, leftAt: e.target.value } : null)}
                className="w-full"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRemoveTarget(null)}>취소</Button>
              <Button variant="destructive" onClick={confirmRemove} disabled={!removeTarget?.leftAt || removeStudent.isPending}>
                퇴원
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
