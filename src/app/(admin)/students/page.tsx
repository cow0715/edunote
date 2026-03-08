'use client'

import { useState } from 'react'
import { Plus, Users, Pencil, Trash2, Phone, School, Link } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { StudentFormDialog } from '@/components/students/student-form-dialog'
import { useStudents, useDeleteStudent } from '@/hooks/use-students'
import { Student } from '@/lib/types'
import { toast } from 'sonner'

export default function StudentsPage() {
  const { data: students, isLoading } = useStudents()
  const deleteStudent = useDeleteStudent()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Student | undefined>()

  function handleEdit(s: Student) {
    setEditTarget(s)
    setDialogOpen(true)
  }

  function handleDelete(id: string) {
    if (confirm('학생을 삭제하시겠습니까? 관련 데이터가 모두 삭제됩니다.')) {
      deleteStudent.mutate(id)
    }
  }

  function handleCreate() {
    setEditTarget(undefined)
    setDialogOpen(true)
  }

  function handleCopyLink(token: string) {
    const url = `${window.location.origin}/share/${token}`
    navigator.clipboard.writeText(url)
    toast.success('공유 링크가 복사되었습니다')
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">학생 관리</h1>
          <p className="mt-1 text-sm text-gray-500">전체 학생 목록</p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="mr-2 h-4 w-4" />
          학생 등록
        </Button>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : students?.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
            <Users className="mb-3 h-10 w-10 text-gray-300" />
            <p className="text-sm text-gray-500">등록된 학생이 없어요</p>
            <Button variant="outline" className="mt-4" onClick={handleCreate}>
              첫 학생 등록하기
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {students?.map((s) => (
              <Card key={s.id} className="group">
                <CardContent className="flex items-center gap-4 py-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {s.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900">{s.name}</p>
                    <div className="flex gap-3 mt-0.5">
                      {s.grade && (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <School className="h-3 w-3" />{s.school ? `${s.school} ` : ''}{s.grade}
                        </span>
                      )}
                      {s.father_phone && (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <Phone className="h-3 w-3" />부 {s.father_phone}
                        </span>
                      )}
                      {s.mother_phone && (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <Phone className="h-3 w-3" />모 {s.mother_phone}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-7 px-2 text-blue-500 hover:text-blue-600" onClick={() => handleCopyLink(s.share_token)} title="학부모 공유 링크 복사">
                      <Link className="h-3.5 w-3.5" />
                    </Button>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => handleEdit(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-red-500 hover:text-red-600" onClick={() => handleDelete(s.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <StudentFormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} editTarget={editTarget} />
    </div>
  )
}
