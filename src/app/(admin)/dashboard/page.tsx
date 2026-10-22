'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, BookOpen, Calendar, Pencil, Trash2, Archive, ArchiveRestore, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ClassFormDialog } from '@/components/classes/class-form-dialog'
import { useClasses, useDeleteClass, useArchiveClass } from '@/hooks/use-classes'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Class } from '@/lib/types'
import styles from './class-list.module.css'

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function DashboardPage() {
  const [filter, setFilter] = useState<'active' | 'archived' | 'all'>('active')
  const [archiveTarget, setArchiveTarget] = useState<Class | null>(null)
  const { data: allClasses, isLoading, isError, refetch } = useClasses(true)
  const classes = allClasses?.filter(cls => filter === 'all' || (filter === 'archived' ? !!cls.archived_at : !cls.archived_at))
  const deleteClass = useDeleteClass()
  const archiveClass = useArchiveClass()

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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">수업 목록</h1>
          <p className="mt-1 text-sm text-gray-500">수업을 선택하면 상세 내용을 확인할 수 있습니다</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleCreate}>
            <Plus className="mr-2 h-4 w-4" />
            수업 생성
          </Button>
        </div>
      </div>

      <div className={`mt-6 flex w-fit gap-1 rounded-2xl p-1 ${styles.statusFilter}`} role="group" aria-label="수업 상태">
        {([['active', '운영 중'], ['archived', '보관된 반'], ['all', '전체']] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-medium ${styles.statusButton}`}>{label}</button>
        ))}
      </div>
      {filter === 'archived' && <p className="mt-3 text-sm text-gray-500">보관한 수업의 기록을 확인하거나 운영 중으로 복원할 수 있어요.</p>}

      <div className="mt-6">
        {isError ? (
          <div className="rounded-2xl bg-gray-50 p-8 text-center"><p className="text-sm">수업을 불러오지 못했어요.</p><Button className="mt-3" variant="outline" onClick={() => void refetch()}>다시 시도</Button></div>
        ) : isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-40 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : classes?.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
            <BookOpen className="mb-3 h-10 w-10 text-gray-300" />
            <p className="text-sm text-gray-500">{filter === 'archived' ? '보관된 반이 없어요' : '아직 운영 중인 수업이 없어요'}</p>
            <Button variant="outline" className="mt-4" onClick={handleCreate} hidden={filter === 'archived'}>
              첫 수업 만들기
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {classes?.map((cls) => (
              <Card key={cls.id} className={`relative rounded-[20px] border-0 shadow-none ${styles.classCard}`}>
                <Link href={`/dashboard/${cls.id}`} className="absolute inset-0 z-0 cursor-pointer rounded-[20px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:bg-accent" aria-label={`${cls.name} 수업 열기`} />
                <CardHeader className="pointer-events-none pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {cls.name}
                    {cls.class_type === 'special' && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                        특강
                      </span>
                    )}
                    {cls.archived_at && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                        보관됨
                      </span>
                    )}
                  </CardTitle>
                  {cls.description && (
                    <p className="text-xs text-gray-500 line-clamp-1">{cls.description}</p>
                  )}
                </CardHeader>
                <CardContent className="pointer-events-none">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>{formatDate(cls.start_date)} ~ {formatDate(cls.end_date)}</span>
                  </div>
                  <div className="relative z-10 mt-3 flex justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" className="pointer-events-auto h-11 w-11 cursor-pointer rounded-xl hover:bg-[var(--control-selected)] dark:hover:bg-[var(--control-selected)] data-[state=open]:bg-[var(--control-selected)]" aria-label={`${cls.name} 관리`}><MoreHorizontal className="h-5 w-5" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="shadow-none">
                        <DropdownMenuItem className="min-h-11" onSelect={() => handleEdit(cls)}><Pencil className="h-4 w-4" />수업 수정</DropdownMenuItem>
                        <DropdownMenuItem className="min-h-11" disabled={archiveClass.isPending} onSelect={() => setArchiveTarget(cls)}>{cls.archived_at ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}{cls.archived_at ? '운영 중으로 복원' : '수업 보관'}</DropdownMenuItem>
                        <DropdownMenuItem className="min-h-11 text-red-500" disabled={deleteClass.isPending} onSelect={() => handleDelete(cls.id)}><Trash2 className="h-4 w-4" />수업 삭제</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!archiveTarget} onOpenChange={open => { if (!open) setArchiveTarget(null) }}>
        <DialogContent className="sm:max-w-sm shadow-none">
          <DialogHeader>
            <DialogTitle>{archiveTarget?.archived_at ? '운영 중인 수업으로 복원할까요?' : '수업을 보관할까요?'}</DialogTitle>
            <DialogDescription className="pt-2 leading-6">{archiveTarget?.name}<br />{archiveTarget?.archived_at ? '수업 목록과 학생·학부모 공유 화면에서 다시 볼 수 있어요.' : '기록은 그대로 남아요. 학생·학부모 공유 화면과 단어 재시험에서는 이 반이 제외돼요.'}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setArchiveTarget(null)}>취소</Button><Button disabled={archiveClass.isPending} onClick={() => {
            if (archiveTarget) archiveClass.mutate({ id: archiveTarget.id, archive: !archiveTarget.archived_at }, { onSuccess: () => setArchiveTarget(null) })
          }}>{archiveClass.isPending ? '변경 중…' : archiveTarget?.archived_at ? '복원하기' : '보관하기'}</Button></div>
        </DialogContent>
      </Dialog>
      <ClassFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        editTarget={editTarget}
      />
    </div>
  )
}
