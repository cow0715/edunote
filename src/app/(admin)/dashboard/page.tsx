'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, BookOpen, Calendar, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ClassFormDialog } from '@/components/classes/class-form-dialog'
import { useClasses, useDeleteClass } from '@/hooks/use-classes'
import { Class } from '@/lib/types'

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function DashboardPage() {
  const { data: classes, isLoading } = useClasses()
  const deleteClass = useDeleteClass()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Class | undefined>()

  function handleEdit(cls: Class) {
    setEditTarget(cls)
    setDialogOpen(true)
  }

  function handleDelete(id: string) {
    if (confirm('수업을 삭제하시겠습니까? 관련 데이터가 모두 삭제됩니다.')) {
      deleteClass.mutate(id)
    }
  }

  function handleCreate() {
    setEditTarget(undefined)
    setDialogOpen(true)
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">수업 목록</h1>
          <p className="mt-1 text-sm text-gray-500">수업을 선택하면 상세 내용을 확인할 수 있습니다</p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="mr-2 h-4 w-4" />
          수업 생성
        </Button>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-40 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : classes?.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
            <BookOpen className="mb-3 h-10 w-10 text-gray-300" />
            <p className="text-sm text-gray-500">아직 수업이 없어요</p>
            <Button variant="outline" className="mt-4" onClick={handleCreate}>
              첫 수업 만들기
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {classes?.map((cls) => (
              <Card key={cls.id} className="group relative hover:shadow-md transition-shadow">
                <Link href={`/dashboard/${cls.id}`} className="absolute inset-0 z-0" />
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{cls.name}</CardTitle>
                  {cls.description && (
                    <p className="text-xs text-gray-500 line-clamp-1">{cls.description}</p>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>{formatDate(cls.start_date)} ~ {formatDate(cls.end_date)}</span>
                  </div>
                  <div className="relative z-10 mt-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2"
                      onClick={(e) => { e.preventDefault(); handleEdit(cls) }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-red-500 hover:text-red-600"
                      onClick={(e) => { e.preventDefault(); handleDelete(cls.id) }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <ClassFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        editTarget={editTarget}
      />
    </div>
  )
}
