'use client'

import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Student } from '@/lib/types'
import { useCreateStudent, useUpdateStudent } from '@/hooks/use-students'

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

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<FormValues>()

  useEffect(() => {
    if (open) {
      reset(editTarget
        ? {
            name: editTarget.name,
            phone: editTarget.phone ?? '',
            father_phone: editTarget.father_phone ?? '',
            mother_phone: editTarget.mother_phone ?? '',
            school: editTarget.school ?? '',
            grade: editTarget.grade ?? '',
            memo: editTarget.memo ?? '',
          }
        : { name: '', phone: '', father_phone: '', mother_phone: '', school: '', grade: '', memo: '' }
      )
    }
  }, [open, editTarget, reset])

  async function onSubmit(values: FormValues) {
    if (isEdit && editTarget) {
      await updateStudent.mutateAsync({ id: editTarget.id, ...values })
    } else {
      await createStudent.mutateAsync(values)
    }
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
