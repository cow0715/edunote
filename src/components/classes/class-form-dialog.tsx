'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Class } from '@/lib/types'
import { useCreateClass, useUpdateClass } from '@/hooks/use-classes'

interface FormValues {
  name: string
  description: string
  start_date: string
  end_date: string
}

interface Props {
  open: boolean
  onClose: () => void
  editTarget?: Class
}

const DAYS = [
  { key: 'mon', label: '월' },
  { key: 'tue', label: '화' },
  { key: 'wed', label: '수' },
  { key: 'thu', label: '목' },
  { key: 'fri', label: '금' },
  { key: 'sat', label: '토' },
  { key: 'sun', label: '일' },
]

export function ClassFormDialog({ open, onClose, editTarget }: Props) {
  const isEdit = !!editTarget
  const createClass = useCreateClass()
  const updateClass = useUpdateClass()
  const [scheduleDays, setScheduleDays] = useState<string[]>([])

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>()

  useEffect(() => {
    if (open) {
      reset(editTarget
        ? {
            name: editTarget.name,
            description: editTarget.description ?? '',
            start_date: editTarget.start_date,
            end_date: editTarget.end_date,
          }
        : { name: '', description: '', start_date: '', end_date: '' }
      )
      setScheduleDays(editTarget?.schedule_days ?? [])
    }
  }, [open, editTarget, reset])

  function toggleDay(day: string) {
    setScheduleDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    )
  }

  async function onSubmit(values: FormValues) {
    if (isEdit && editTarget) {
      await updateClass.mutateAsync({ id: editTarget.id, ...values, schedule_days: scheduleDays })
    } else {
      await createClass.mutateAsync({ ...values, schedule_days: scheduleDays })
    }
    onClose()
  }

  const isPending = createClass.isPending || updateClass.isPending

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? '수업 수정' : '수업 생성'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="name">수업명 *</Label>
            <Input
              id="name"
              placeholder="예) 중3 심화반"
              {...register('name', { required: '수업명을 입력해주세요' })}
            />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">설명</Label>
            <Textarea
              id="description"
              placeholder="수업에 대한 간단한 설명"
              rows={2}
              {...register('description')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="start_date">시작일 *</Label>
              <Input
                id="start_date"
                type="date"
                {...register('start_date', { required: '시작일을 선택해주세요' })}
              />
              {errors.start_date && <p className="text-xs text-red-500">{errors.start_date.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_date">종료일 *</Label>
              <Input
                id="end_date"
                type="date"
                {...register('end_date', { required: '종료일을 선택해주세요' })}
              />
              {errors.end_date && <p className="text-xs text-red-500">{errors.end_date.message}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label>수업 요일</Label>
            <div className="flex gap-1.5">
              {DAYS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleDay(key)}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-medium transition-colors border
                    ${scheduleDays.includes(key)
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                    }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {scheduleDays.length > 0 && (
              <p className="text-xs text-gray-400">
                주 {scheduleDays.length}회 · 선택된 요일로 주차가 자동 생성됩니다
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              취소
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? '저장 중...' : isEdit ? '수정' : '생성'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
