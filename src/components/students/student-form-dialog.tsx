'use client'

import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Student } from '@/lib/types'
import { useCreateStudent, useUpdateStudent, useWithdrawStudent, useStudentEnrollments, useUpdateJoinedAt } from '@/hooks/use-students'
import { useClasses } from '@/hooks/use-classes'

const GRADE_OPTIONS = [
  { value: '고1', label: '고1' },
  { value: '고2', label: '고2' },
  { value: '고3', label: '고3' },
]

interface FormValues {
  name: string
  phone: string
  father_phone: string
  mother_phone: string
  school: string
  grade: string
  memo: string
  class_id: string
  joined_at: string
}

interface Props {
  open: boolean
  onClose: () => void
  editTarget?: Student
}

export function StudentFormDialog({ open, onClose, editTarget }: Props) {
  const isEdit = !!editTarget
  const createStudent = useCreateStudent()
  const updateStudent = useUpdateStudent()
  const withdrawStudent = useWithdrawStudent()
  const updateJoinedAt = useUpdateJoinedAt()
  const { data: classes = [] } = useClasses()
  const { data: enrollments = [] } = useStudentEnrollments(editTarget?.id)

  const [withdrawDate, setWithdrawDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [withdrawConfirm, setWithdrawConfirm] = useState(false)
  const [editingJoinedAt, setEditingJoinedAt] = useState<Record<string, string>>({})

  const { register, handleSubmit, reset, control, watch, formState: { errors } } = useForm<FormValues>()
  const classId = watch('class_id')

  useEffect(() => {
    if (open) {
      setWithdrawConfirm(false)
      setWithdrawDate(new Date().toISOString().slice(0, 10))
      setEditingJoinedAt({})
      reset(editTarget
        ? {
            name: editTarget.name,
            phone: editTarget.phone ?? '',
            father_phone: editTarget.father_phone ?? '',
            mother_phone: editTarget.mother_phone ?? '',
            school: editTarget.school ?? '',
            grade: editTarget.grade ?? '',
            memo: editTarget.memo ?? '',
            class_id: '',
            joined_at: '',
          }
        : { name: '', phone: '', father_phone: '', mother_phone: '', school: '', grade: '', memo: '', class_id: '', joined_at: new Date().toISOString().slice(0, 10) }
      )
    }
  }, [open, editTarget, reset])

  async function onSubmit(values: FormValues) {
    if (isEdit && editTarget) {
      await updateStudent.mutateAsync({ id: editTarget.id, ...values })
    } else {
      await createStudent.mutateAsync({
        ...values,
        class_id: values.class_id || undefined,
        joined_at: values.class_id ? values.joined_at : undefined,
      })
    }
    onClose()
  }

  async function handleWithdraw() {
    if (!editTarget) return
    await withdrawStudent.mutateAsync({ studentId: editTarget.id, left_at: withdrawDate })
    setWithdrawConfirm(false)
    onClose()
  }

  const isPending = createStudent.isPending || updateStudent.isPending

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? '학생 정보 수정' : '학생 등록'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 pt-2">
          <div className="space-y-2">
            <Label htmlFor="name">이름 *</Label>
            <Input id="name" placeholder="홍길동" {...register('name', { required: '이름을 입력해주세요' })} />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="school">학교</Label>
              <Input id="school" placeholder="예) 중학교" {...register('school')} />
            </div>
            <div className="space-y-2">
              <Label>학년</Label>
              <Controller
                name="grade"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {GRADE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">학생 연락처</Label>
            <Input id="phone" placeholder="010-0000-0000" {...register('phone')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="father_phone">아버지 연락처</Label>
              <Input id="father_phone" placeholder="010-0000-0000" {...register('father_phone')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mother_phone">어머니 연락처</Label>
              <Input id="mother_phone" placeholder="010-0000-0000" {...register('mother_phone')} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="memo">메모</Label>
            <Textarea id="memo" placeholder="특이사항 등" rows={2} {...register('memo')} />
          </div>

          {/* 신규 등록: 수업 배정 */}
          {!isEdit && (
            <div className="space-y-3 rounded-lg border border-dashed p-3">
              <p className="text-xs font-medium text-gray-500">수업 배정 (선택)</p>
              <div className="space-y-2">
                <Label>수업</Label>
                <Controller
                  name="class_id"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="배정 안 함" />
                      </SelectTrigger>
                      <SelectContent>
                        {classes.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              {classId && (
                <div className="space-y-2">
                  <Label>입원일</Label>
                  <Input type="date" {...register('joined_at')} className="w-full" />
                </div>
              )}
            </div>
          )}

          {/* 수정: 수강 중인 수업 + 입원일 편집 */}
          {isEdit && enrollments.length > 0 && (
            <div className="space-y-2 rounded-lg border border-dashed p-3">
              <p className="text-xs font-medium text-gray-500">수업별 입원일</p>
              <div className="space-y-2">
                {enrollments.map((e) => {
                  const current = editingJoinedAt[e.class_id] ?? (e.joined_at ? e.joined_at.slice(0, 10) : '')
                  const original = e.joined_at ? e.joined_at.slice(0, 10) : ''
                  const isDirty = current !== original
                  return (
                    <div key={e.class_id} className="flex items-center gap-2">
                      <span className={`flex-1 text-sm ${e.left_at ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                        {e.class?.name ?? '-'}
                        {e.left_at && <span className="ml-1 text-xs">(퇴원)</span>}
                      </span>
                      <Input
                        type="date"
                        value={current}
                        onChange={(ev) => setEditingJoinedAt((prev) => ({ ...prev, [e.class_id]: ev.target.value }))}
                        className="w-36 h-7 text-xs"
                      />
                      {isDirty && (
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={updateJoinedAt.isPending}
                          onClick={() => {
                            if (!editTarget) return
                            updateJoinedAt.mutate({ classId: e.class_id, studentId: editTarget.id, joined_at: current })
                            setEditingJoinedAt((prev) => { const n = { ...prev }; delete n[e.class_id]; return n })
                          }}
                        >
                          저장
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 수정: 퇴원 처리 */}
          {isEdit && (
            <div className="space-y-2 rounded-lg border border-dashed p-3">
              <p className="text-xs font-medium text-gray-500">퇴원 처리</p>
              {withdrawConfirm ? (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label>퇴원일</Label>
                    <Input type="date" value={withdrawDate} onChange={(e) => setWithdrawDate(e.target.value)} className="w-full" />
                  </div>
                  <p className="text-xs text-gray-400">모든 수업에서 퇴원 처리됩니다.</p>
                  <div className="flex gap-2">
                    <Button type="button" variant="destructive" size="sm" onClick={handleWithdraw} disabled={withdrawStudent.isPending}>
                      {withdrawStudent.isPending ? '처리 중...' : '퇴원 확정'}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setWithdrawConfirm(false)}>취소</Button>
                  </div>
                </div>
              ) : (
                <Button type="button" variant="outline" size="sm" className="text-red-500 hover:text-red-600 hover:border-red-300" onClick={() => setWithdrawConfirm(true)}>
                  퇴원 처리
                </Button>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>취소</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? '저장 중...' : isEdit ? '수정' : '등록'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
