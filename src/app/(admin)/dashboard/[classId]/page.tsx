'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, UserPlus, UserMinus, Users, CalendarPlus, ClipboardList, Link as LinkIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Class, ClassStudent, Student } from '@/lib/types'
import { toast } from 'sonner'
import { useClassStudents, useStudents, useAddClassStudent, useRemoveClassStudent } from '@/hooks/use-students'
import { useWeeks, useCreateWeek } from '@/hooks/use-weeks'

async function fetchClass(id: string): Promise<Class> {
  const res = await fetch(`/api/classes/${id}`)
  if (!res.ok) throw new Error('수업 정보를 불러올 수 없습니다')
  return res.json()
}

export default function ClassDetailPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = use(params)
  const [addOpen, setAddOpen] = useState(false)

  const { data: cls, isLoading: classLoading } = useQuery({
    queryKey: ['class', classId],
    queryFn: () => fetchClass(classId),
  })
  const { data: classStudents = [] } = useClassStudents(classId)
  const { data: allStudents = [] } = useStudents()
  const { data: weeks = [] } = useWeeks(classId)
  const addStudent = useAddClassStudent(classId)
  const removeStudent = useRemoveClassStudent(classId)
  const createWeek = useCreateWeek(classId)

  const enrolledIds = new Set((classStudents as ClassStudent[]).map((cs) => cs.student_id))
  const unenrolled = (allStudents as Student[]).filter((s) => !enrolledIds.has(s.id))

  function handleRemove(studentId: string) {
    if (confirm('수업에서 학생을 제거하시겠습니까?')) removeStudent.mutate(studentId)
  }

  function handleCopyLink(token: string) {
    const url = `${window.location.origin}/share/${token}`
    navigator.clipboard.writeText(url)
    toast.success('공유 링크가 복사되었습니다')
  }

  if (classLoading) return <div className="h-8 w-48 rounded bg-gray-100 animate-pulse" />
  if (!cls) return <p className="text-sm text-gray-500">수업을 찾을 수 없습니다</p>

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
                          onClick={() => handleCopyLink(cs.student!.share_token!)}
                          title="학부모 공유 링크 복사"
                        >
                          <LinkIcon className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-600"
                        onClick={() => handleRemove(cs.student_id)}
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
          <div className="flex justify-end mb-3">
            <Button size="sm" variant="outline" onClick={() => createWeek.mutate()} disabled={createWeek.isPending}>
              <CalendarPlus className="mr-1.5 h-4 w-4" />
              주차 추가
            </Button>
          </div>

          {weeks.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
              <p className="text-sm text-gray-500">아직 주차가 없어요</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => createWeek.mutate()} disabled={createWeek.isPending}>
                1주차 추가하기
              </Button>
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
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>학생 추가</DialogTitle>
          </DialogHeader>
          {unenrolled.length === 0 ? (
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
                  onClick={() => { addStudent.mutate(s.id); setAddOpen(false) }}
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
    </div>
  )
}
