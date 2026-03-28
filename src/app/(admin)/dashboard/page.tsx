'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, BookOpen, Calendar, Pencil, Trash2, Download, RefreshCw } from 'lucide-react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ClassFormDialog } from '@/components/classes/class-form-dialog'
import { useClasses, useDeleteClass } from '@/hooks/use-classes'
import { Class } from '@/lib/types'
import { toast } from 'sonner'

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
}

function BackupPanel() {
  const [restoringFile, setRestoringFile] = useState<string | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['backup-files'],
    queryFn: async () => {
      const res = await fetch('/api/backup')
      if (!res.ok) throw new Error('목록 조회 실패')
      return res.json() as Promise<{ files: { name: string; created_at: string }[] }>
    },
  })

  const runBackup = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/backup', { method: 'POST' })
      if (!res.ok) throw new Error('백업 실패')
      return res.json()
    },
    onSuccess: (d) => {
      toast.success(`백업 완료: ${d.file}`)
      refetch()
    },
    onError: () => toast.error('백업에 실패했습니다'),
  })

  async function download(fileName: string) {
    const res = await fetch(`/api/backup?file=${encodeURIComponent(fileName)}`)
    const { url } = await res.json()
    window.open(url, '_blank')
  }

  async function restore(fileName: string) {
    if (!confirm(`"${fileName}" 파일로 복원하시겠습니까?\n현재 데이터에 덮어씁니다.`)) return
    setRestoringFile(fileName)
    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: fileName }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        toast.success('복원 완료')
      } else {
        const failed = Object.entries(data.results ?? {})
          .filter(([, v]) => (v as { error?: string }).error)
          .map(([k]) => k)
          .join(', ')
        toast.error(`일부 테이블 복원 실패: ${failed}`)
      }
    } catch {
      toast.error('복원 중 오류가 발생했습니다')
    } finally {
      setRestoringFile(null)
    }
  }

  return (
    <div className="mt-10 rounded-xl border bg-white p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">데이터 백업</h2>
          <p className="text-xs text-gray-400 mt-0.5">매일 새벽 3시 자동 저장 · 최근 30개 보관</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => runBackup.mutate()} disabled={runBackup.isPending}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${runBackup.isPending ? 'animate-spin' : ''}`} />
          {runBackup.isPending ? '백업 중...' : '지금 백업'}
        </Button>
      </div>
      {isLoading ? (
        <div className="h-16 animate-pulse rounded-lg bg-gray-50" />
      ) : (data?.files ?? []).length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">아직 백업 파일이 없습니다</p>
      ) : (
        <div className="space-y-1.5">
          {(data?.files ?? []).slice(0, 10).map((f) => (
            <div key={f.name} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
              <span className="text-xs text-gray-700">{f.name}</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => restore(f.name)}
                  disabled={!!restoringFile}
                  className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 disabled:opacity-40"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${restoringFile === f.name ? 'animate-spin' : ''}`} />
                  {restoringFile === f.name ? '복원 중...' : '복원'}
                </button>
                <button
                  onClick={() => download(f.name)}
                  className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  다운로드
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
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
                      disabled={deleteClass.isPending}
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

      <BackupPanel />
    </div>
  )
}
