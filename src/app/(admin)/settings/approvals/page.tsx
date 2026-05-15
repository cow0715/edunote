'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ShieldAlert, UserX } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type ApprovalStatus = 'pending' | 'approved' | 'blocked'

interface TeacherRow {
  id: string
  name: string
  email: string
  approval_status: ApprovalStatus
  is_admin: boolean
  created_at: string
  approved_at: string | null
}

const statusLabels: Record<ApprovalStatus, string> = {
  pending: '승인 대기',
  approved: '승인됨',
  blocked: '차단됨',
}

export default function TeacherApprovalsPage() {
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['teacher-approvals'],
    queryFn: async (): Promise<{ teachers: TeacherRow[] }> => {
      const res = await fetch('/api/admin/teachers')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '승인 목록을 불러오지 못했습니다')
      return json
    },
  })

  async function updateStatus(teacherId: string, status: ApprovalStatus) {
    setUpdatingId(teacherId)
    try {
      const res = await fetch('/api/admin/teachers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherId, status }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '상태 변경에 실패했습니다')
      toast.success('계정 상태를 변경했습니다')
      refetch()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">가입 승인</h1>
        <p className="mt-1 text-sm text-gray-500">
          신규 강사 계정을 승인하거나 차단합니다.
        </p>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-500">불러오는 중...</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>강사</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>가입일</TableHead>
                <TableHead className="text-right">관리</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.teachers ?? []).map((teacher) => (
                <TableRow key={teacher.id}>
                  <TableCell>
                    <div className="font-medium text-gray-900">{teacher.name}</div>
                    <div className="text-xs text-gray-500">{teacher.email}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant={teacher.approval_status === 'approved' ? 'default' : 'secondary'}>
                        {statusLabels[teacher.approval_status]}
                      </Badge>
                      {teacher.is_admin && (
                        <Badge variant="outline" className="text-[#2463EB]">
                          관리자
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-gray-500">
                    {new Date(teacher.created_at).toLocaleDateString('ko-KR')}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        onClick={() => updateStatus(teacher.id, 'approved')}
                        disabled={updatingId === teacher.id || teacher.approval_status === 'approved'}
                      >
                        <Check className="mr-1 h-4 w-4" />
                        승인
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateStatus(teacher.id, 'pending')}
                        disabled={updatingId === teacher.id || teacher.approval_status === 'pending'}
                      >
                        <ShieldAlert className="mr-1 h-4 w-4" />
                        대기
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => updateStatus(teacher.id, 'blocked')}
                        disabled={updatingId === teacher.id || teacher.approval_status === 'blocked'}
                      >
                        <UserX className="mr-1 h-4 w-4" />
                        차단
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
